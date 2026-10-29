//! F9 per-task doc links (`doc_links`, migration 0040). App-owned rows, keyed by
//! the owning tracker (its module id) and that tracker's task id.

use serde::Serialize;
use sqlx::SqlitePool;

/// What a link points at, already validated by the command layer.
#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    Url(String),
    Doc { source_id: String, path: String },
}

/// The editable part of a link.
#[derive(Clone, Debug, PartialEq)]
pub struct LinkFields {
    pub target: Target,
    pub title: Option<String>,
    pub note: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocLink {
    pub id: String,
    pub tracker: String,
    pub task_id: String,
    /// `url` | `doc`
    pub kind: String,
    pub url: Option<String>,
    pub source_id: Option<String>,
    pub doc_path: Option<String>,
    pub title: Option<String>,
    pub note: Option<String>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: String,
    tracker: String,
    task_id: String,
    kind: String,
    url: Option<String>,
    source_id: Option<String>,
    doc_path: Option<String>,
    title: Option<String>,
    note: Option<String>,
    tags: String,
    created_at: String,
    updated_at: String,
}

impl From<Row> for DocLink {
    fn from(r: Row) -> Self {
        DocLink {
            id: r.id,
            tracker: r.tracker,
            task_id: r.task_id,
            kind: r.kind,
            url: r.url,
            source_id: r.source_id,
            doc_path: r.doc_path,
            title: r.title,
            note: r.note,
            // Written only by this module, so it is always a JSON string array.
            tags: serde_json::from_str(&r.tags).unwrap_or_default(),
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

const SELECT: &str = "SELECT id, tracker, task_id, kind, url, source_id, doc_path, title, note, \
                      tags, created_at, updated_at FROM doc_links";

/// The target split into its columns: (kind, url, source_id, doc_path).
fn columns(target: &Target) -> (&'static str, Option<&str>, Option<&str>, Option<&str>) {
    match target {
        Target::Url(url) => ("url", Some(url), None, None),
        Target::Doc { source_id, path } => ("doc", None, Some(source_id), Some(path)),
    }
}

fn tags_json(tags: &[String]) -> String {
    serde_json::to_string(tags).expect("strings serialize")
}

/// One task's links, oldest first.
pub async fn list(
    pool: &SqlitePool,
    tracker: &str,
    task_id: &str,
) -> Result<Vec<DocLink>, sqlx::Error> {
    let rows: Vec<Row> = sqlx::query_as(&format!(
        "{SELECT} WHERE tracker = ?1 AND task_id = ?2 ORDER BY created_at, rowid"
    ))
    .bind(tracker)
    .bind(task_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(DocLink::from).collect())
}

pub async fn load(pool: &SqlitePool, id: &str) -> Result<Option<DocLink>, sqlx::Error> {
    let row: Option<Row> = sqlx::query_as(&format!("{SELECT} WHERE id = ?1"))
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(DocLink::from))
}

pub async fn insert(
    pool: &SqlitePool,
    id: &str,
    tracker: &str,
    task_id: &str,
    fields: &LinkFields,
    now: &str,
) -> Result<DocLink, sqlx::Error> {
    let (kind, url, source_id, doc_path) = columns(&fields.target);
    sqlx::query(
        "INSERT INTO doc_links (id, tracker, task_id, kind, url, source_id, doc_path, title, note, \
         tags, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
    )
    .bind(id)
    .bind(tracker)
    .bind(task_id)
    .bind(kind)
    .bind(url)
    .bind(source_id)
    .bind(doc_path)
    .bind(&fields.title)
    .bind(&fields.note)
    .bind(tags_json(&fields.tags))
    .bind(now)
    .execute(pool)
    .await?;
    load(pool, id).await?.ok_or(sqlx::Error::RowNotFound)
}

/// Replace a link's target, title, note and tags. `None` when no such link.
pub async fn update(
    pool: &SqlitePool,
    id: &str,
    fields: &LinkFields,
    now: &str,
) -> Result<Option<DocLink>, sqlx::Error> {
    let (kind, url, source_id, doc_path) = columns(&fields.target);
    let done = sqlx::query(
        "UPDATE doc_links SET kind = ?2, url = ?3, source_id = ?4, doc_path = ?5, title = ?6, \
         note = ?7, tags = ?8, updated_at = ?9 WHERE id = ?1",
    )
    .bind(id)
    .bind(kind)
    .bind(url)
    .bind(source_id)
    .bind(doc_path)
    .bind(&fields.title)
    .bind(&fields.note)
    .bind(tags_json(&fields.tags))
    .bind(now)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Ok(None);
    }
    load(pool, id).await
}

/// False when no such link.
pub async fn delete(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let done = sqlx::query("DELETE FROM doc_links WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(done.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    fn web(url: &str) -> LinkFields {
        LinkFields {
            target: Target::Url(url.into()),
            title: None,
            note: None,
            tags: vec![],
        }
    }

    #[tokio::test]
    async fn links_are_listed_per_task_oldest_first() {
        let (_d, pool) = pool().await;
        insert(&pool, "dl_2", "linear", "issue-1", &web("https://b"), "t2")
            .await
            .unwrap();
        insert(&pool, "dl_1", "linear", "issue-1", &web("https://a"), "t1")
            .await
            .unwrap();
        insert(&pool, "dl_3", "linear", "issue-2", &web("https://c"), "t1")
            .await
            .unwrap();
        // Same task id under another tracker is another task.
        insert(
            &pool,
            "dl_4",
            "local-tasks",
            "issue-1",
            &web("https://d"),
            "t1",
        )
        .await
        .unwrap();

        let ids: Vec<String> = list(&pool, "linear", "issue-1")
            .await
            .unwrap()
            .into_iter()
            .map(|l| l.id)
            .collect();
        assert_eq!(ids, ["dl_1", "dl_2"]);
        assert_eq!(
            list(&pool, "local-tasks", "issue-1").await.unwrap().len(),
            1
        );
        assert!(list(&pool, "linear", "nope").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_doc_link_round_trips_with_note_and_tags() {
        let (_d, pool) = pool().await;
        let fields = LinkFields {
            target: Target::Doc {
                source_id: "acme/docs@main".into(),
                path: "guide/setup.md".into(),
            },
            title: Some("Setup".into()),
            note: Some("Read before deploying".into()),
            tags: vec!["ops".into(), "deploy".into()],
        };
        let saved = insert(&pool, "dl_1", "local-tasks", "lt_1", &fields, "t1")
            .await
            .unwrap();
        assert_eq!(
            saved,
            DocLink {
                id: "dl_1".into(),
                tracker: "local-tasks".into(),
                task_id: "lt_1".into(),
                kind: "doc".into(),
                url: None,
                source_id: Some("acme/docs@main".into()),
                doc_path: Some("guide/setup.md".into()),
                title: Some("Setup".into()),
                note: Some("Read before deploying".into()),
                tags: vec!["ops".into(), "deploy".into()],
                created_at: "t1".into(),
                updated_at: "t1".into(),
            }
        );
        let json = serde_json::to_value(&saved).unwrap();
        assert_eq!(json["taskId"], "lt_1");
        assert_eq!(json["sourceId"], "acme/docs@main");
        assert_eq!(json["docPath"], "guide/setup.md");
    }

    #[tokio::test]
    async fn update_replaces_the_fields_and_keeps_the_creation_time() {
        let (_d, pool) = pool().await;
        insert(&pool, "dl_1", "linear", "i1", &web("https://a"), "t1")
            .await
            .unwrap();
        let next = LinkFields {
            target: Target::Doc {
                source_id: "local:/notes".into(),
                path: "a.md".into(),
            },
            title: Some("A".into()),
            note: None,
            tags: vec!["x".into()],
        };
        let updated = update(&pool, "dl_1", &next, "t2").await.unwrap().unwrap();
        assert_eq!(updated.kind, "doc");
        assert_eq!(updated.url, None);
        assert_eq!(updated.doc_path.as_deref(), Some("a.md"));
        assert_eq!(updated.tags, ["x"]);
        assert_eq!(
            (updated.created_at.as_str(), updated.updated_at.as_str()),
            ("t1", "t2")
        );
        assert_eq!(update(&pool, "dl_x", &next, "t2").await.unwrap(), None);
    }

    #[tokio::test]
    async fn delete_reports_whether_the_link_existed() {
        let (_d, pool) = pool().await;
        insert(&pool, "dl_1", "linear", "i1", &web("https://a"), "t1")
            .await
            .unwrap();
        assert!(delete(&pool, "dl_1").await.unwrap());
        assert!(!delete(&pool, "dl_1").await.unwrap());
        assert!(load(&pool, "dl_1").await.unwrap().is_none());
    }

    fn is_unique_violation(r: Result<DocLink, sqlx::Error>) -> bool {
        matches!(r, Err(sqlx::Error::Database(e)) if e.is_unique_violation())
    }

    #[tokio::test]
    async fn a_task_holds_each_target_once() {
        let (_d, pool) = pool().await;
        let doc = |path: &str| LinkFields {
            target: Target::Doc {
                source_id: "s".into(),
                path: path.into(),
            },
            title: None,
            note: None,
            tags: vec![],
        };
        insert(&pool, "dl_1", "linear", "i1", &web("https://a"), "t")
            .await
            .unwrap();
        insert(&pool, "dl_2", "linear", "i1", &doc("a.md"), "t")
            .await
            .unwrap();
        assert!(is_unique_violation(
            insert(&pool, "dl_3", "linear", "i1", &web("https://a"), "t").await
        ));
        assert!(is_unique_violation(
            insert(&pool, "dl_3", "linear", "i1", &doc("a.md"), "t").await
        ));
        // The same target on another task, or under another tracker, is fine.
        insert(&pool, "dl_4", "linear", "i2", &web("https://a"), "t")
            .await
            .unwrap();
        insert(&pool, "dl_5", "local-tasks", "i1", &doc("a.md"), "t")
            .await
            .unwrap();
        // Editing a link into a duplicate is refused too.
        insert(&pool, "dl_6", "linear", "i1", &web("https://b"), "t")
            .await
            .unwrap();
        assert!(matches!(
            update(&pool, "dl_6", &web("https://a"), "t2").await,
            Err(sqlx::Error::Database(e)) if e.is_unique_violation()
        ));
    }

    #[tokio::test]
    async fn the_table_refuses_a_target_that_does_not_match_its_kind() {
        let (_d, pool) = pool().await;
        let bad = sqlx::query(
            "INSERT INTO doc_links (id, tracker, task_id, kind, url, source_id, doc_path, \
             created_at, updated_at) VALUES ('x', 'linear', 'i', 'url', NULL, 's', 'p', 't', 't')",
        )
        .execute(&pool)
        .await;
        assert!(bad.is_err());
    }
}
