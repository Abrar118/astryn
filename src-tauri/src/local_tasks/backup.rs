//! Backup and restore of local tasks. SQLite is the only copy of this data, so
//! the app keeps daily snapshots and can export/restore one JSON document.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};
use sqlx::{Column, Row, SqlitePool};

use super::{db, now, valid_date, LtError};

pub const FORMAT: &str = "astryn-local-tasks";
pub const VERSION: u64 = 1;
/// Daily snapshots kept in the backups folder.
pub const KEEP_DAILY: usize = 14;
/// Restore refuses files larger than this.
pub const MAX_BACKUP_BYTES: u64 = 64 * 1024 * 1024;
const DAILY_PREFIX: &str = "local-tasks-";

/// Every table with its columns, parents first (the order a restore inserts in).
const TABLES: &[(&str, &[&str])] = &[
    (
        "lt_spaces",
        &["id", "name", "position", "created_at", "updated_at"],
    ),
    (
        "lt_lists",
        &[
            "id",
            "space_id",
            "name",
            "key",
            "next_number",
            "position",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "lt_statuses",
        &["id", "scope_id", "name", "category", "color", "position"],
    ),
    (
        "lt_sprints",
        &["id", "space_id", "number", "name", "start_date", "end_date"],
    ),
    ("lt_labels", &["id", "name", "color"]),
    (
        "lt_tasks",
        &[
            "id",
            "list_id",
            "number",
            "title",
            "description",
            "status_id",
            "priority",
            "assigned_to_me",
            "start_date",
            "due_date",
            "estimate",
            "parent_id",
            "sprint_id",
            "position",
            "created_at",
            "updated_at",
            "started_at",
            "completed_at",
        ],
    ),
    ("lt_task_labels", &["task_id", "label_id"]),
    (
        "lt_checklist_items",
        &["id", "task_id", "body", "done", "position"],
    ),
    ("lt_relations", &["task_id", "related_id", "type"]),
    (
        "lt_comments",
        &["id", "task_id", "body", "created_at", "updated_at"],
    ),
    (
        "lt_attachments",
        &["id", "task_id", "title", "url", "created_at"],
    ),
    ("lt_imports", &["source", "source_id", "task_id"]),
];

fn cell(row: &sqlx::sqlite::SqliteRow, i: usize) -> Value {
    if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
        return v.map_or(Value::Null, Value::from);
    }
    if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
        return v.map_or(Value::Null, Value::from);
    }
    row.try_get::<Option<String>, _>(i)
        .ok()
        .flatten()
        .map_or(Value::Null, Value::from)
}

/// The whole local-tasks dataset as one JSON document.
pub async fn snapshot(pool: &SqlitePool) -> Result<Value, LtError> {
    // One read transaction: every table comes from the same moment, so a write
    // landing mid-snapshot can't produce rows that break a later restore's FKs.
    let mut tx = pool.begin().await?;
    let mut tables = Map::new();
    for (table, cols) in TABLES {
        let rows = sqlx::query(&format!("SELECT {} FROM {table}", cols.join(", ")))
            .fetch_all(&mut *tx)
            .await?;
        let out: Vec<Value> = rows
            .iter()
            .map(|row| {
                let mut obj = Map::new();
                for (i, col) in row.columns().iter().enumerate() {
                    obj.insert(col.name().to_string(), cell(row, i));
                }
                Value::Object(obj)
            })
            .collect();
        tables.insert((*table).to_string(), Value::Array(out));
    }
    tx.commit().await?;
    Ok(json!({ "format": FORMAT, "version": VERSION, "exportedAt": now(), "tables": tables }))
}

/// Check the format, version, tables and columns before touching the database.
pub fn validate(doc: &Value) -> Result<(), LtError> {
    if doc.get("format").and_then(Value::as_str) != Some(FORMAT)
        || doc.get("version").and_then(Value::as_u64) != Some(VERSION)
    {
        return Err(LtError::BadBackup);
    }
    let tables = doc
        .get("tables")
        .and_then(Value::as_object)
        .ok_or(LtError::BadBackup)?;
    for (name, rows) in tables {
        let cols = TABLES
            .iter()
            .find(|(t, _)| t == name)
            .map(|(_, c)| *c)
            .ok_or(LtError::BadBackup)?;
        for row in rows.as_array().ok_or(LtError::BadBackup)? {
            let obj = row.as_object().ok_or(LtError::BadBackup)?;
            let ok = obj.iter().all(|(k, v)| {
                cols.contains(&k.as_str())
                    && (v.is_null() || v.is_string() || v.is_number() || v.is_boolean())
            });
            if !ok {
                return Err(LtError::BadBackup);
            }
        }
    }
    Ok(())
}

/// Replace all local-task data with `doc` in one transaction.
pub async fn restore(pool: &SqlitePool, doc: &Value) -> Result<(), LtError> {
    validate(doc)?;
    let tables = doc["tables"].as_object().ok_or(LtError::BadBackup)?;
    let mut tx = pool.begin().await?;
    db::wipe_in(&mut tx).await?;
    for (table, cols) in TABLES {
        let Some(rows) = tables.get(*table).and_then(Value::as_array) else {
            continue;
        };
        let placeholders = (1..=cols.len())
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "INSERT INTO {table} ({}) VALUES ({placeholders})",
            cols.join(", ")
        );
        for row in rows {
            let mut q = sqlx::query(&sql);
            for col in *cols {
                q = match row.get(*col) {
                    Some(Value::String(s)) => q.bind(s.clone()),
                    Some(Value::Bool(b)) => q.bind(*b),
                    Some(Value::Number(n)) => match n.as_i64() {
                        Some(i) => q.bind(i),
                        None => q.bind(n.as_f64()),
                    },
                    _ => q.bind(Option::<String>::None),
                };
            }
            // A row that breaks a constraint means the file is not a usable backup.
            q.execute(&mut *tx).await.map_err(|_| LtError::BadBackup)?;
        }
    }
    tx.commit().await?;
    Ok(())
}

pub async fn has_data(pool: &SqlitePool) -> Result<bool, LtError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM lt_spaces) OR EXISTS(SELECT 1 FROM lt_tasks)",
    )
    .fetch_one(pool)
    .await?)
}

pub async fn write_file(path: &Path, doc: &Value) -> Result<(), LtError> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|_| LtError::Write)?;
    }
    let text = serde_json::to_vec_pretty(doc).map_err(|_| LtError::Write)?;
    // Write then rename, so a crash never leaves a half-written backup behind.
    let tmp = path.with_extension("json.tmp");
    tokio::fs::write(&tmp, text)
        .await
        .map_err(|_| LtError::Write)?;
    tokio::fs::rename(&tmp, path)
        .await
        .map_err(|_| LtError::Write)
}

pub async fn read_file(path: &Path) -> Result<Value, LtError> {
    let meta = tokio::fs::metadata(path).await.map_err(|_| LtError::Io)?;
    if meta.len() > MAX_BACKUP_BYTES {
        return Err(LtError::BadBackup);
    }
    let bytes = tokio::fs::read(path).await.map_err(|_| LtError::Io)?;
    serde_json::from_slice(&bytes).map_err(|_| LtError::BadBackup)
}

fn daily_name(today: &str) -> String {
    format!("{DAILY_PREFIX}{today}.json")
}

/// Dates of the daily snapshots in `dir`, newest first. The directory scan is
/// blocking, so it runs off the async executor.
pub async fn daily_backups(dir: &Path) -> Vec<String> {
    let dir = dir.to_path_buf();
    tokio::task::spawn_blocking(move || scan_daily(&dir))
        .await
        .unwrap_or_default()
}

fn scan_daily(dir: &Path) -> Vec<String> {
    let mut dates: Vec<String> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok()?.file_name().into_string().ok())
                .filter_map(|n| {
                    n.strip_prefix(DAILY_PREFIX)?
                        .strip_suffix(".json")
                        .map(str::to_string)
                })
                .filter(|d| valid_date(d))
                .collect()
        })
        .unwrap_or_default();
    dates.sort_unstable_by(|a, b| b.cmp(a));
    dates
}

/// Write today's snapshot once (Dhaka date from the frontend) when there is
/// anything to save, then keep only the newest `KEEP_DAILY`.
pub async fn ensure_daily(
    pool: &SqlitePool,
    dir: &Path,
    today: &str,
) -> Result<Option<PathBuf>, LtError> {
    if !valid_date(today) {
        return Err(LtError::Invalid);
    }
    let path = dir.join(daily_name(today));
    let mut written = None;
    if !tokio::fs::try_exists(&path).await.unwrap_or(false) && has_data(pool).await? {
        write_file(&path, &snapshot(pool).await?).await?;
        written = Some(path);
    }
    for old in daily_backups(dir).await.into_iter().skip(KEEP_DAILY) {
        let _ = tokio::fs::remove_file(dir.join(daily_name(&old))).await;
    }
    Ok(written)
}

/// A one-off safety snapshot (before a restore or data removal); never rotated.
pub async fn write_safety(
    pool: &SqlitePool,
    dir: &Path,
    reason: &str,
) -> Result<Option<PathBuf>, LtError> {
    if !has_data(pool).await? {
        return Ok(None);
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = dir.join(format!("safety-{reason}-{stamp}.json"));
    write_file(&path, &snapshot(pool).await?).await?;
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_tasks::db::tests::{input, seeded};

    #[tokio::test]
    async fn snapshot_round_trips_through_restore() {
        let (_d, pool, list, _) = seeded().await;
        let mut a = input(&list, "Keep me");
        a.estimate = Some(2.5);
        a.due_date = Some("2026-11-01".into());
        a.assigned_to_me = Some(true);
        let a = db::create_task(&pool, &a).await.unwrap();
        db::add_comment(&pool, &a.id, "note").await.unwrap();
        let a = db::get_task(&pool, &a.id).await.unwrap();
        let doc = snapshot(&pool).await.unwrap();
        validate(&doc).unwrap();

        db::wipe(&pool).await.unwrap();
        db::create_task(&pool, &input(&list, "gone"))
            .await
            .unwrap_err();
        restore(&pool, &doc).await.unwrap();
        let back = db::get_task(&pool, &a.id).await.unwrap();
        assert_eq!(back, a);
        assert_eq!(
            db::get_detail(&pool, &a.id).await.unwrap().comments.len(),
            1
        );
    }

    #[tokio::test]
    async fn restore_rejects_foreign_documents_without_touching_data() {
        let (_d, pool, list, _) = seeded().await;
        db::create_task(&pool, &input(&list, "Safe")).await.unwrap();
        for bad in [
            json!({ "format": "other", "version": 1, "tables": {} }),
            json!({ "format": FORMAT, "version": 2, "tables": {} }),
            json!({ "format": FORMAT, "version": 1, "tables": { "users": [] } }),
            json!({ "format": FORMAT, "version": 1, "tables": { "lt_tasks": [{ "evil": 1 }] } }),
            // Valid shape, broken constraint (task in a list that doesn't exist).
            json!({ "format": FORMAT, "version": 1, "tables": { "lt_tasks": [{
                "id": "lt_x", "list_id": "nope", "number": 1, "title": "x", "status_id": "s",
                "priority": 0, "assigned_to_me": 0, "position": 0.0, "created_at": "t", "updated_at": "t" }] } }),
        ] {
            assert!(matches!(
                restore(&pool, &bad).await,
                Err(LtError::BadBackup)
            ));
        }
        let left = db::list_tasks(&pool, &db::Filters::default())
            .await
            .unwrap();
        assert_eq!(left.len(), 1);
    }

    #[tokio::test]
    async fn daily_snapshots_are_written_once_and_rotated() {
        let (dir, pool, list, _) = seeded().await;
        db::create_task(&pool, &input(&list, "x")).await.unwrap();
        let backups = dir.path().join("backups");
        for day in 1..=16 {
            let date = format!("2026-10-{day:02}");
            ensure_daily(&pool, &backups, &date).await.unwrap();
        }
        assert!(ensure_daily(&pool, &backups, "2026-10-16")
            .await
            .unwrap()
            .is_none());
        let kept = daily_backups(&backups).await;
        assert_eq!(kept.len(), KEEP_DAILY);
        assert_eq!(kept[0], "2026-10-16");
        assert!(matches!(
            ensure_daily(&pool, &backups, "../x").await,
            Err(LtError::Invalid)
        ));
        let doc = read_file(&backups.join("local-tasks-2026-10-16.json"))
            .await
            .unwrap();
        validate(&doc).unwrap();
    }

    #[tokio::test]
    async fn nothing_to_save_writes_nothing() {
        let (dir, pool) = crate::local_tasks::db::tests::pool().await;
        let backups = dir.path().join("backups");
        assert!(ensure_daily(&pool, &backups, "2026-10-28")
            .await
            .unwrap()
            .is_none());
        assert!(write_safety(&pool, &backups, "restore")
            .await
            .unwrap()
            .is_none());
    }
}
