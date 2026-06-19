use sqlx::{Sqlite, SqlitePool, Transaction};

#[derive(Debug, Clone, PartialEq, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CalendarIssue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub due_date: Option<String>,
    pub priority: i64,
    pub state_type: String,
    pub state_color: String,
    pub assignee_id: Option<String>,
    pub team_id: Option<String>,
    pub team_key: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub due_date: Option<String>,
    pub priority: i64,
    pub url: String,
    pub state_id: Option<String>,
    pub state_name: Option<String>,
    pub state_type: String,
    pub state_color: String,
    pub assignee_id: Option<String>,
    pub assignee_name: Option<String>,
    pub team_id: Option<String>,
    pub team_key: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub parent_id: Option<String>,
    pub estimate: Option<i64>,
    pub cycle_name: Option<String>,
    pub cycle_number: Option<i64>,
    pub milestone_name: Option<String>,
    pub link_count: i64,
    pub pr_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub id: String,
    pub name: Option<String>,
    pub color: Option<String>,
}

/// A list-view issue: the cached read-shape plus its labels. (Labels can't live
/// on `Issue` itself — `LiveDetail` flattens `Issue` and has its own `labels`.)
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueListItem {
    #[serde(flatten)]
    pub issue: Issue,
    pub labels: Vec<Label>,
}

#[derive(Debug, Clone)]
pub struct IssueRecord {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub due_date: Option<String>,
    pub priority: i64,
    pub url: String,
    pub state_id: Option<String>,
    pub state_name: Option<String>,
    pub state_type: Option<String>,
    pub state_color: Option<String>,
    pub assignee_id: Option<String>,
    pub assignee_name: Option<String>,
    pub team_id: Option<String>,
    pub team_key: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub parent_id: Option<String>,
    pub estimate: Option<i64>,
    pub cycle_name: Option<String>,
    pub cycle_number: Option<i64>,
    pub milestone_name: Option<String>,
    pub link_count: i64,
    pub pr_count: i64,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub raw_json: String,
}

#[derive(Debug, Clone)]
pub struct LabelRecord {
    pub label_id: String,
    pub name: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct TeamOption {
    pub id: String,
    pub key: String,
}
#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct ProjectOption {
    pub id: String,
    pub name: String,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct FilterOptions {
    pub teams: Vec<TeamOption>,
    pub projects: Vec<ProjectOption>,
}

/// Conditional upsert: an incoming record with an older `updated_at` never
/// clobbers a newer cached row. Returns true if the row was inserted/updated.
pub async fn upsert_issue(
    tx: &mut Transaction<'_, Sqlite>,
    r: &IssueRecord,
) -> Result<bool, sqlx::Error> {
    let id: Option<(String,)> = sqlx::query_as(
        "INSERT INTO issues
           (id, identifier, title, description, due_date, priority, url,
            state_id, state_name, state_type, state_color, assignee_id, assignee_name,
            team_id, team_key, project_id, project_name, parent_id,
            estimate, cycle_name, cycle_number, milestone_name, link_count, pr_count,
            created_at, updated_at, archived_at, synced_at, raw_json)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27, datetime('now'), ?28)
         ON CONFLICT(id) DO UPDATE SET
           identifier=excluded.identifier, title=excluded.title, description=excluded.description,
           due_date=excluded.due_date, priority=excluded.priority, url=excluded.url,
           state_id=excluded.state_id, state_name=excluded.state_name, state_type=excluded.state_type,
           state_color=excluded.state_color, assignee_id=excluded.assignee_id, assignee_name=excluded.assignee_name,
           team_id=excluded.team_id, team_key=excluded.team_key, project_id=excluded.project_id,
           project_name=excluded.project_name, parent_id=excluded.parent_id,
           estimate=excluded.estimate, cycle_name=excluded.cycle_name, cycle_number=excluded.cycle_number,
           milestone_name=excluded.milestone_name, link_count=excluded.link_count, pr_count=excluded.pr_count,
           created_at=excluded.created_at, updated_at=excluded.updated_at, archived_at=excluded.archived_at,
           synced_at=excluded.synced_at, raw_json=excluded.raw_json
         WHERE excluded.updated_at >= issues.updated_at
         RETURNING id",
    )
    .bind(&r.id)
    .bind(&r.identifier)
    .bind(&r.title)
    .bind(&r.description)
    .bind(&r.due_date)
    .bind(r.priority)
    .bind(&r.url)
    .bind(&r.state_id)
    .bind(&r.state_name)
    .bind(&r.state_type)
    .bind(&r.state_color)
    .bind(&r.assignee_id)
    .bind(&r.assignee_name)
    .bind(&r.team_id)
    .bind(&r.team_key)
    .bind(&r.project_id)
    .bind(&r.project_name)
    .bind(&r.parent_id)
    .bind(r.estimate)
    .bind(&r.cycle_name)
    .bind(r.cycle_number)
    .bind(&r.milestone_name)
    .bind(r.link_count)
    .bind(r.pr_count)
    .bind(&r.created_at)
    .bind(&r.updated_at)
    .bind(&r.archived_at)
    .bind(&r.raw_json)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(id.is_some())
}

pub async fn replace_labels(
    tx: &mut Transaction<'_, Sqlite>,
    issue_id: &str,
    labels: &[LabelRecord],
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM labels WHERE issue_id = ?1")
        .bind(issue_id)
        .execute(&mut **tx)
        .await?;
    for l in labels {
        sqlx::query("INSERT INTO labels (issue_id, label_id, name, color) VALUES (?1,?2,?3,?4)")
            .bind(issue_id)
            .bind(&l.label_id)
            .bind(&l.name)
            .bind(&l.color)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

const CAL_COLS: &str = "id, identifier, title, due_date, COALESCE(priority,0) AS priority,
    COALESCE(state_type,'') AS state_type, COALESCE(state_color,'') AS state_color,
    assignee_id, team_id, team_key, project_id";

pub async fn load_issues_in_range(
    pool: &SqlitePool,
    start: &str,
    end: &str,
    team_id: Option<String>,
    assignee_id: Option<String>,
    project_id: Option<String>,
) -> Result<Vec<CalendarIssue>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {CAL_COLS} FROM issues
         WHERE archived_at IS NULL AND due_date >= ?1 AND due_date < ?2
           AND (?3 IS NULL OR team_id = ?3)
           AND (?4 IS NULL OR assignee_id = ?4)
           AND (?5 IS NULL OR project_id = ?5)
         ORDER BY due_date, identifier"
    ))
    .bind(start)
    .bind(end)
    .bind(team_id)
    .bind(assignee_id)
    .bind(project_id)
    .fetch_all(pool)
    .await
}

pub async fn load_unscheduled(
    pool: &SqlitePool,
    team_id: Option<String>,
    assignee_id: Option<String>,
    project_id: Option<String>,
) -> Result<Vec<CalendarIssue>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {CAL_COLS} FROM issues
         WHERE archived_at IS NULL AND due_date IS NULL
           AND (?1 IS NULL OR team_id = ?1)
           AND (?2 IS NULL OR assignee_id = ?2)
           AND (?3 IS NULL OR project_id = ?3)
         ORDER BY identifier"
    ))
    .bind(team_id)
    .bind(assignee_id)
    .bind(project_id)
    .fetch_all(pool)
    .await
}

const ISSUE_COLS: &str =
    "id, identifier, title, description, due_date, COALESCE(priority,0) AS priority, url,
    state_id, state_name, COALESCE(state_type,'') AS state_type,
    COALESCE(state_color,'') AS state_color, assignee_id, assignee_name,
    team_id, team_key, project_id, project_name, parent_id,
    estimate, cycle_name, cycle_number, milestone_name,
    COALESCE(link_count,0) AS link_count, COALESCE(pr_count,0) AS pr_count,
    created_at, updated_at";

pub async fn load_issue(pool: &SqlitePool, id: &str) -> Result<Option<Issue>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {ISSUE_COLS} FROM issues WHERE id = ?1 AND archived_at IS NULL"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// All non-archived cached issues (for the list view), newest-updated first,
/// each with its labels attached.
pub async fn load_issues(
    pool: &SqlitePool,
    team_id: Option<String>,
    assignee_id: Option<String>,
    project_id: Option<String>,
) -> Result<Vec<IssueListItem>, sqlx::Error> {
    let issues: Vec<Issue> = sqlx::query_as(&format!(
        "SELECT {ISSUE_COLS} FROM issues
         WHERE archived_at IS NULL
           AND (?1 IS NULL OR team_id = ?1)
           AND (?2 IS NULL OR assignee_id = ?2)
           AND (?3 IS NULL OR project_id = ?3)
         ORDER BY updated_at DESC, identifier"
    ))
    .bind(team_id)
    .bind(assignee_id)
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    // Attach labels in one pass. The workspace cache is single-tenant and bounded,
    // so loading all labels and grouping in memory is cheaper than N queries.
    let rows: Vec<(String, String, Option<String>, Option<String>)> =
        sqlx::query_as("SELECT issue_id, label_id, name, color FROM labels")
            .fetch_all(pool)
            .await?;
    let mut by_issue: std::collections::HashMap<String, Vec<Label>> =
        std::collections::HashMap::new();
    for (issue_id, id, name, color) in rows {
        by_issue
            .entry(issue_id)
            .or_default()
            .push(Label { id, name, color });
    }
    Ok(issues
        .into_iter()
        .map(|issue| {
            let labels = by_issue.remove(&issue.id).unwrap_or_default();
            IssueListItem { issue, labels }
        })
        .collect())
}

pub async fn list_filter_options(pool: &SqlitePool) -> Result<FilterOptions, sqlx::Error> {
    let teams: Vec<TeamOption> = sqlx::query_as(
        "SELECT DISTINCT team_id AS id, team_key AS key FROM issues
         WHERE archived_at IS NULL AND team_id IS NOT NULL AND team_key IS NOT NULL
         ORDER BY team_key",
    )
    .fetch_all(pool)
    .await?;
    let projects: Vec<ProjectOption> = sqlx::query_as(
        "SELECT DISTINCT project_id AS id, project_name AS name FROM issues
         WHERE archived_at IS NULL AND project_id IS NOT NULL AND project_name IS NOT NULL
         ORDER BY project_name",
    )
    .fetch_all(pool)
    .await?;
    Ok(FilterOptions { teams, projects })
}

const CURSOR_SOURCE: &str = "linear_issues";
const CURSOR_KEY: &str = "last_updated_at";

pub async fn get_sync_cursor(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT value FROM sync_cursors WHERE source = ?1 AND key = ?2")
            .bind(CURSOR_SOURCE)
            .bind(CURSOR_KEY)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|r| r.0))
}

pub async fn set_sync_cursor(pool: &SqlitePool, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO sync_cursors (source, key, value) VALUES (?1, ?2, ?3)
         ON CONFLICT(source, key) DO UPDATE SET value = excluded.value",
    )
    .bind(CURSOR_SOURCE)
    .bind(CURSOR_KEY)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

/// One transaction: drop all cached workspace data + identity. Used on key change / Resync.
pub async fn wipe_workspace_cache(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM issues").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM labels").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM sync_cursors")
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "DELETE FROM settings WHERE key IN
         ('linear_viewer_name','linear_viewer_id','linear_org_id','linear_org_name','linear_org_url_key')",
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_pool;

    async fn pool() -> (tempfile::TempDir, sqlx::SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = init_pool(&dir.path().join("astryn/test.db")).await.unwrap();
        (dir, pool)
    }

    fn rec(id: &str, due: Option<&str>, updated: &str) -> IssueRecord {
        IssueRecord {
            id: id.into(),
            identifier: format!("ENG-{id}"),
            title: "T".into(),
            description: None,
            due_date: due.map(Into::into),
            priority: 0,
            url: "u".into(),
            state_id: Some("s".into()),
            state_name: Some("Todo".into()),
            state_type: Some("unstarted".into()),
            state_color: Some("#fff".into()),
            assignee_id: Some("me".into()),
            assignee_name: Some("Me".into()),
            team_id: Some("t1".into()),
            team_key: Some("ENG".into()),
            project_id: Some("p1".into()),
            project_name: Some("Proj".into()),
            parent_id: None,
            estimate: None,
            cycle_name: None,
            cycle_number: None,
            milestone_name: None,
            link_count: 0,
            pr_count: 0,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: updated.into(),
            archived_at: None,
            raw_json: "{}".into(),
        }
    }

    async fn upsert(pool: &sqlx::SqlitePool, r: &IssueRecord) -> bool {
        let mut tx = pool.begin().await.unwrap();
        let applied = upsert_issue(&mut tx, r).await.unwrap();
        tx.commit().await.unwrap();
        applied
    }

    #[tokio::test]
    async fn upsert_inserts_then_conditionally_updates() {
        let (_d, p) = pool().await;
        assert!(upsert(&p, &rec("1", Some("2026-06-10"), "2026-06-01T00:00:00Z")).await);
        // Newer update applies.
        assert!(upsert(&p, &rec("1", Some("2026-06-11"), "2026-06-02T00:00:00Z")).await);
        // Older update is rejected.
        assert!(!upsert(&p, &rec("1", Some("2026-06-09"), "2026-05-01T00:00:00Z")).await);
        let got = load_issue(&p, "1").await.unwrap().unwrap();
        assert_eq!(got.due_date.as_deref(), Some("2026-06-11"));
    }

    #[tokio::test]
    async fn range_is_half_open_and_excludes_archived() {
        let (_d, p) = pool().await;
        upsert(&p, &rec("1", Some("2026-06-01"), "t1")).await;
        upsert(&p, &rec("2", Some("2026-06-30"), "t1")).await; // exclusive end -> excluded
        let mut arch = rec("3", Some("2026-06-15"), "t1");
        arch.archived_at = Some("2026-06-16T00:00:00Z".into());
        upsert(&p, &arch).await;
        let got = load_issues_in_range(&p, "2026-06-01", "2026-06-30", None, None, None)
            .await
            .unwrap();
        let ids: Vec<_> = got.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, vec!["1"]); // 2 is at exclusive end, 3 is archived
    }

    #[tokio::test]
    async fn unscheduled_returns_null_due_only_filtered_by_assignee() {
        let (_d, p) = pool().await;
        upsert(&p, &rec("1", None, "t1")).await;
        let mut other = rec("2", None, "t1");
        other.assignee_id = Some("someone".into());
        upsert(&p, &other).await;
        upsert(&p, &rec("3", Some("2026-06-10"), "t1")).await; // has due -> excluded
        let got = load_unscheduled(&p, None, Some("me".into()), None)
            .await
            .unwrap();
        let ids: Vec<_> = got.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, vec!["1"]);
    }

    #[tokio::test]
    async fn labels_replaced_and_pruned() {
        let (_d, p) = pool().await;
        upsert(&p, &rec("1", Some("2026-06-10"), "t1")).await;
        let mut tx = p.begin().await.unwrap();
        replace_labels(
            &mut tx,
            "1",
            &[
                LabelRecord {
                    label_id: "a".into(),
                    name: Some("bug".into()),
                    color: Some("#f00".into()),
                },
                LabelRecord {
                    label_id: "b".into(),
                    name: Some("ui".into()),
                    color: None,
                },
            ],
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        // Replace with a single label -> "a"/"b"? only "c" remains.
        let mut tx = p.begin().await.unwrap();
        replace_labels(
            &mut tx,
            "1",
            &[LabelRecord {
                label_id: "c".into(),
                name: Some("perf".into()),
                color: None,
            }],
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        let rows: Vec<(String,)> =
            sqlx::query_as("SELECT label_id FROM labels WHERE issue_id='1' ORDER BY label_id")
                .fetch_all(&p)
                .await
                .unwrap();
        assert_eq!(
            rows.iter().map(|r| r.0.clone()).collect::<Vec<_>>(),
            vec!["c".to_string()]
        );
    }

    #[tokio::test]
    async fn new_scalar_fields_roundtrip() {
        let (_d, p) = pool().await;
        let mut r = rec("1", Some("2026-06-10"), "t1");
        r.estimate = Some(5);
        r.cycle_name = Some("Sprint 1".into());
        r.cycle_number = Some(1);
        r.milestone_name = Some("Beta".into());
        upsert(&p, &r).await;
        let got = load_issue(&p, "1").await.unwrap().unwrap();
        assert_eq!(got.estimate, Some(5));
        assert_eq!(got.cycle_number, Some(1));
        assert_eq!(got.cycle_name.as_deref(), Some("Sprint 1"));
        assert_eq!(got.milestone_name.as_deref(), Some("Beta"));
    }

    #[tokio::test]
    async fn load_issues_attaches_labels() {
        let (_d, p) = pool().await;
        upsert(&p, &rec("1", Some("2026-06-10"), "t1")).await;
        upsert(&p, &rec("2", None, "t1")).await;
        let mut tx = p.begin().await.unwrap();
        replace_labels(
            &mut tx,
            "1",
            &[LabelRecord {
                label_id: "a".into(),
                name: Some("bug".into()),
                color: Some("#f00".into()),
            }],
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        let items = load_issues(&p, None, None, None).await.unwrap();
        assert_eq!(items.len(), 2);
        let one = items.iter().find(|i| i.issue.id == "1").unwrap();
        assert_eq!(one.labels.len(), 1);
        assert_eq!(one.labels[0].name.as_deref(), Some("bug"));
        let two = items.iter().find(|i| i.issue.id == "2").unwrap();
        assert!(two.labels.is_empty());
    }

    #[tokio::test]
    async fn cursor_roundtrip_and_filter_options() {
        let (_d, p) = pool().await;
        assert_eq!(get_sync_cursor(&p).await.unwrap(), None);
        set_sync_cursor(&p, "2026-06-01T00:00:00Z").await.unwrap();
        assert_eq!(
            get_sync_cursor(&p).await.unwrap(),
            Some("2026-06-01T00:00:00Z".into())
        );
        upsert(&p, &rec("1", Some("2026-06-10"), "t1")).await;
        let opts = list_filter_options(&p).await.unwrap();
        assert_eq!(opts.teams.len(), 1);
        assert_eq!(opts.teams[0].key, "ENG");
        assert_eq!(opts.projects[0].name, "Proj");
    }

    #[tokio::test]
    async fn wipe_clears_issues_labels_cursors_and_identity() {
        let (_d, p) = pool().await;
        upsert(&p, &rec("1", Some("2026-06-10"), "t1")).await;
        set_sync_cursor(&p, "x").await.unwrap();
        crate::db::save_identity(&p, "vid", "Me", "org1", "GAM", "gam")
            .await
            .unwrap();
        wipe_workspace_cache(&p).await.unwrap();
        assert_eq!(load_issue(&p, "1").await.unwrap(), None);
        assert_eq!(get_sync_cursor(&p).await.unwrap(), None);
        assert_eq!(crate::db::load_org_id(&p).await.unwrap(), None);
    }
}
