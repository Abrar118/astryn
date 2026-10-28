//! One-way copy of cached Linear issues into a local list. Uses the local
//! cache only (no network); issues imported before are skipped, so local edits
//! are never overwritten.

use std::collections::HashMap;

use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};

use super::db::{self, CreateTaskInput};
use super::{new_id, LtError};

const SOURCE: &str = "linear";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: i64,
    pub skipped: i64,
}

#[derive(sqlx::FromRow)]
struct LinearRow {
    id: String,
    title: String,
    description: Option<String>,
    due_date: Option<String>,
    priority: i64,
    state_name: Option<String>,
    state_type: Option<String>,
    state_color: Option<String>,
    assignee_id: Option<String>,
    parent_id: Option<String>,
    estimate: Option<f64>,
}

/// Linear's "triage" has no local category; it lands in the backlog.
fn category(linear_type: Option<&str>) -> &'static str {
    match linear_type {
        Some("unstarted") => "unstarted",
        Some("started") => "started",
        Some("completed") => "completed",
        Some("canceled") => "canceled",
        _ => "backlog",
    }
}

fn color_or_default(color: Option<&str>) -> String {
    match color {
        Some(c) if c.starts_with('#') && (c.len() == 7 || c.len() == 4) => c.to_string(),
        _ => "#8b8d98".to_string(),
    }
}

/// Status id in the list's workflow for a Linear state, adding the state to
/// that workflow when no status has its name.
async fn status_for(
    conn: &mut SqliteConnection,
    list_id: &str,
    row: &LinearRow,
) -> Result<String, LtError> {
    let name = row.state_name.clone().unwrap_or_else(|| "Backlog".into());
    let scope: String = sqlx::query_scalar(
        "SELECT CASE WHEN EXISTS(SELECT 1 FROM lt_statuses WHERE scope_id = l.id) THEN l.id ELSE l.space_id END
         FROM lt_lists l WHERE l.id = ?1",
    )
    .bind(list_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(LtError::NotFound)?;
    if let Some(id) = sqlx::query_scalar::<_, String>(
        "SELECT id FROM lt_statuses WHERE scope_id = ?1 AND name = ?2 COLLATE NOCASE",
    )
    .bind(&scope)
    .bind(&name)
    .fetch_optional(&mut *conn)
    .await?
    {
        return Ok(id);
    }
    let id = new_id();
    sqlx::query(
        "INSERT INTO lt_statuses (id, scope_id, name, category, color, position)
         VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(position) + 1, 0) FROM lt_statuses WHERE scope_id = ?2))",
    )
    .bind(&id)
    .bind(&scope)
    .bind(&name)
    .bind(category(row.state_type.as_deref()))
    .bind(color_or_default(row.state_color.as_deref()))
    .execute(&mut *conn)
    .await?;
    Ok(id)
}

/// Copy the cached issues of Linear team `team_id` into local list `list_id`.
/// `viewer_id` (the Linear viewer) decides "assigned to me".
pub async fn import_linear_team(
    pool: &SqlitePool,
    team_id: &str,
    list_id: &str,
    viewer_id: Option<&str>,
) -> Result<ImportResult, LtError> {
    let mut tx = pool.begin().await?;
    let rows: Vec<LinearRow> = sqlx::query_as(
        "SELECT id, title, description, due_date, COALESCE(priority, 0) AS priority, state_name, state_type,
                state_color, assignee_id, parent_id, estimate
         FROM issues WHERE team_id = ?1 AND archived_at IS NULL ORDER BY created_at, identifier",
    )
    .bind(team_id)
    .fetch_all(&mut *tx)
    .await?;
    let labels: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT lb.issue_id, lb.name, lb.color FROM labels lb JOIN issues i ON i.id = lb.issue_id WHERE i.team_id = ?1",
    )
    .bind(team_id)
    .fetch_all(&mut *tx)
    .await?;
    let mut labels_by_issue: HashMap<String, Vec<(String, String)>> = HashMap::new();
    for (issue, name, color) in labels {
        if let Some(name) = name.filter(|n| !n.trim().is_empty()) {
            labels_by_issue
                .entry(issue)
                .or_default()
                .push((name, color_or_default(color.as_deref())));
        }
    }

    let mut result = ImportResult {
        imported: 0,
        skipped: 0,
    };
    let mut created: Vec<(String, Option<String>)> = Vec::new();
    for row in &rows {
        let already: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM lt_imports WHERE source = ?1 AND source_id = ?2)",
        )
        .bind(SOURCE)
        .bind(&row.id)
        .fetch_one(&mut *tx)
        .await?;
        if already {
            result.skipped += 1;
            continue;
        }
        let status_id = status_for(&mut tx, list_id, row).await?;
        let mut label_ids = Vec::new();
        for (name, color) in labels_by_issue.get(&row.id).into_iter().flatten() {
            label_ids.push(db::create_label_in(&mut tx, name, color).await?.id);
        }
        let input = CreateTaskInput {
            list_id: list_id.to_string(),
            // Local titles are capped; one long Linear title must not abort the import.
            title: if row.title.trim().is_empty() {
                "Untitled".into()
            } else {
                row.title.trim().chars().take(db::MAX_NAME_CHARS).collect()
            },
            description: row.description.clone(),
            status_id: Some(status_id),
            priority: Some(row.priority.clamp(0, 4)),
            assigned_to_me: Some(viewer_id.is_some() && row.assignee_id.as_deref() == viewer_id),
            start_date: None,
            due_date: row.due_date.clone().filter(|d| super::valid_date(d)),
            estimate: row.estimate,
            parent_id: None,
            sprint_id: None,
            label_ids,
        };
        let task = db::insert_task(&mut tx, &input).await?;
        sqlx::query("INSERT INTO lt_imports (source, source_id, task_id) VALUES (?1, ?2, ?3)")
            .bind(SOURCE)
            .bind(&row.id)
            .bind(&task)
            .execute(&mut *tx)
            .await?;
        created.push((task, row.parent_id.clone()));
        result.imported += 1;
    }

    // Keep parents and relations whose both ends exist locally.
    let mapping: HashMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT source_id, task_id FROM lt_imports WHERE source = ?1",
    )
    .bind(SOURCE)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .collect();
    for (task, parent) in &created {
        if let Some(local_parent) = parent.as_ref().and_then(|p| mapping.get(p)) {
            sqlx::query("UPDATE lt_tasks SET parent_id = ?2 WHERE id = ?1")
                .bind(task)
                .bind(local_parent)
                .execute(&mut *tx)
                .await?;
        }
    }
    let relations: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT r.issue_id, r.related_issue_id, r.type FROM relations r
         JOIN issues i ON i.id = r.issue_id WHERE i.team_id = ?1 AND r.type IN ('blocks', 'related')",
    )
    .bind(team_id)
    .fetch_all(&mut *tx)
    .await?;
    for (from, to, kind) in relations {
        if let (Some(a), Some(b)) = (mapping.get(&from), mapping.get(&to)) {
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM lt_relations WHERE type = ?3 AND
                    ((task_id = ?1 AND related_id = ?2) OR (?3 = 'related' AND task_id = ?2 AND related_id = ?1)))",
            )
            .bind(a)
            .bind(b)
            .bind(&kind)
            .fetch_one(&mut *tx)
            .await?;
            if !exists && a != b {
                sqlx::query(
                    "INSERT INTO lt_relations (task_id, related_id, type) VALUES (?1, ?2, ?3)",
                )
                .bind(a)
                .bind(b)
                .bind(&kind)
                .execute(&mut *tx)
                .await?;
            }
        }
    }
    tx.commit().await?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::issues::{
        replace_labels, replace_relations, upsert_issue, IssueRecord, LabelRecord, RelationRecord,
    };
    use crate::local_tasks::db::tests::seeded;

    fn rec(id: &str, state: (&str, &str), assignee: &str, parent: Option<&str>) -> IssueRecord {
        IssueRecord {
            id: id.into(),
            identifier: format!("ENG-{id}"),
            title: format!("Issue {id}"),
            description: Some("Body".into()),
            due_date: Some("2026-11-03".into()),
            started_at: None,
            completed_at: None,
            priority: 2,
            url: "u".into(),
            state_id: Some(format!("s-{}", state.0)),
            state_name: Some(state.0.into()),
            state_type: Some(state.1.into()),
            state_color: Some("#123456".into()),
            assignee_id: Some(assignee.into()),
            assignee_name: None,
            team_id: Some("team".into()),
            team_key: Some("ENG".into()),
            project_id: None,
            project_name: None,
            parent_id: parent.map(Into::into),
            estimate: Some(3.0),
            cycle_name: None,
            cycle_number: None,
            milestone_name: None,
            link_count: 0,
            pr_count: 0,
            attachments_truncated: false,
            created_at: format!("2026-10-0{id}T00:00:00Z"),
            updated_at: "2026-10-10T00:00:00Z".into(),
            archived_at: None,
            raw_json: "{}".into(),
        }
    }

    #[tokio::test]
    async fn imports_once_and_maps_statuses_labels_parents_and_relations() {
        let (_d, pool, list, _) = seeded().await;
        let mut tx = pool.begin().await.unwrap();
        upsert_issue(&mut tx, &rec("1", ("In Review", "started"), "viewer", None))
            .await
            .unwrap();
        upsert_issue(
            &mut tx,
            &rec("2", ("To do", "unstarted"), "someone", Some("1")),
        )
        .await
        .unwrap();
        replace_labels(
            &mut tx,
            "1",
            &[LabelRecord {
                label_id: "l".into(),
                name: Some("Bug".into()),
                color: Some("#ff0000".into()),
            }],
        )
        .await
        .unwrap();
        replace_relations(
            &mut tx,
            "1",
            &[RelationRecord {
                related_issue_id: "2".into(),
                r#type: "blocks".into(),
                related_identifier: None,
                related_title: None,
                related_state_name: None,
                related_state_type: None,
                related_state_color: None,
            }],
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let first = import_linear_team(&pool, "team", &list, Some("viewer"))
            .await
            .unwrap();
        assert_eq!(
            first,
            ImportResult {
                imported: 2,
                skipped: 0
            }
        );
        let tasks = db::list_tasks(&pool, &db::Filters::default())
            .await
            .unwrap();
        let one = tasks.iter().find(|t| t.title == "Issue 1").unwrap();
        let two = tasks.iter().find(|t| t.title == "Issue 2").unwrap();
        assert_eq!(one.state_name.as_deref(), Some("In Review"));
        assert_eq!(one.state_type, "started");
        assert_eq!(one.assignee_id.as_deref(), Some(db::ME));
        assert_eq!(one.labels[0].name, "Bug");
        assert_eq!((one.priority, one.estimate), (2, Some(3.0)));
        assert_eq!(two.state_name.as_deref(), Some("To do"));
        assert_eq!(two.assignee_id, None);
        assert_eq!(two.parent_id.as_deref(), Some(one.id.as_str()));
        let rels = db::relations(&pool).await.unwrap();
        assert!(rels
            .iter()
            .any(|r| r.issue_id == one.id && r.r#type == "blocks"));

        let long = IssueRecord {
            title: "x".repeat(300),
            ..rec("3", ("To do", "unstarted"), "someone", None)
        };
        let mut tx = pool.begin().await.unwrap();
        upsert_issue(&mut tx, &long).await.unwrap();
        tx.commit().await.unwrap();
        let with_long = import_linear_team(&pool, "team", &list, Some("viewer"))
            .await
            .unwrap();
        assert_eq!(with_long.imported, 1);
        let tasks = db::list_tasks(&pool, &db::Filters::default())
            .await
            .unwrap();
        let truncated = tasks.iter().find(|t| t.title.starts_with("xxx")).unwrap();
        assert_eq!(truncated.title.chars().count(), 200);

        let again = import_linear_team(&pool, "team", &list, Some("viewer"))
            .await
            .unwrap();
        assert_eq!(
            again,
            ImportResult {
                imported: 0,
                skipped: 3
            }
        );
        assert_eq!(
            db::list_tasks(&pool, &db::Filters::default())
                .await
                .unwrap()
                .len(),
            3
        );
    }
}
