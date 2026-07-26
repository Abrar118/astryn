use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::Path;

pub mod docs;
pub mod github;
pub mod issues;
pub mod slack;

pub async fn init_pool(db_path: &Path) -> Result<SqlitePool, sqlx::Error> {
    // Fail loudly if the data directory cannot be created (no silent .ok()).
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(sqlx::Error::Io)?;
    }
    let opts = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new().connect_with(opts).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

const VIEWER_NAME_KEY: &str = "linear_viewer_name";

// Identity setting keys — used by save_identity / load_me / load_org_id.
const VIEWER_ID_KEY: &str = "linear_viewer_id";
const ORG_ID_KEY: &str = "linear_org_id";
const ORG_NAME_KEY: &str = "linear_org_name";
const ORG_URL_KEY_KEY: &str = "linear_org_url_key";

/// Generic key-value write — used by save_identity; kept for future flexibility.
#[allow(dead_code)]
pub async fn save_setting(pool: &SqlitePool, key: &str, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

/// Generic key-value read — used by load_org_id / load_me; kept for future flexibility.
#[allow(dead_code)]
pub async fn load_setting(pool: &SqlitePool, key: &str) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?1")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.0))
}

/// Persist the full identity (viewer id+name and org id/name/urlKey) atomically,
/// so a partial failure can't leave a half-written identity.
pub async fn save_identity(
    pool: &SqlitePool,
    viewer_id: &str,
    viewer_name: &str,
    org_id: &str,
    org_name: &str,
    org_url_key: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for (k, v) in [
        (VIEWER_NAME_KEY, viewer_name),
        (VIEWER_ID_KEY, viewer_id),
        (ORG_ID_KEY, org_id),
        (ORG_NAME_KEY, org_name),
        (ORG_URL_KEY_KEY, org_url_key),
    ] {
        sqlx::query(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(k)
        .bind(v)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn load_org_id(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    load_setting(pool, ORG_ID_KEY).await
}

/// (viewer_id, viewer_name) if both are cached.
pub async fn load_me(pool: &SqlitePool) -> Result<Option<(String, String)>, sqlx::Error> {
    let id = load_setting(pool, VIEWER_ID_KEY).await?;
    let name = load_viewer_name(pool).await?;
    Ok(match (id, name) {
        (Some(i), Some(n)) => Some((i, n)),
        _ => None,
    })
}

pub async fn load_viewer_name(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?1")
        .bind(VIEWER_NAME_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn temp_pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        // Nested path so init_pool's create_dir_all is actually exercised.
        let pool = init_pool(&dir.path().join("astryn/test.db")).await.unwrap();
        (dir, pool)
    }

    #[tokio::test]
    async fn migration_creates_settings_table() {
        let (_dir, pool) = temp_pool().await;
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM settings")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 0);
    }

    #[tokio::test]
    async fn save_identity_sets_loadable_viewer_name() {
        let (_dir, pool) = temp_pool().await;
        assert_eq!(load_viewer_name(&pool).await.unwrap(), None);
        save_identity(&pool, "v1", "Abrar", "org1", "GAM", "gam")
            .await
            .unwrap();
        assert_eq!(
            load_viewer_name(&pool).await.unwrap(),
            Some("Abrar".to_string())
        );
        // upsert: saving new identity overwrites the name
        save_identity(&pool, "v1", "Abrar 2", "org1", "GAM", "gam")
            .await
            .unwrap();
        assert_eq!(
            load_viewer_name(&pool).await.unwrap(),
            Some("Abrar 2".to_string())
        );
    }

    #[tokio::test]
    async fn migration_creates_github_tables() {
        let (_dir, pool) = temp_pool().await;
        let prs: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM github_prs")
            .fetch_one(&pool)
            .await
            .unwrap();
        let meta: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM github_sync_meta")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!((prs.0, meta.0), (0, 0));
    }

    #[tokio::test]
    async fn migration_creates_slack_tables() {
        let (_dir, pool) = temp_pool().await;
        for table in [
            "slack_conversations",
            "slack_messages",
            "slack_users",
            "slack_sync_meta",
        ] {
            let n: (i64,) = sqlx::query_as(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap_or_else(|e| panic!("table {table} missing: {e}"));
            assert_eq!(n.0, 0);
        }
    }

    #[tokio::test]
    async fn migration_creates_docs_tables() {
        let (_dir, pool) = temp_pool().await;
        for table in ["docs_files", "docs_sync_meta", "docs_sources"] {
            let n: (i64,) = sqlx::query_as(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap_or_else(|e| panic!("table {table} missing: {e}"));
            assert_eq!(n.0, 0);
        }
    }

    fn migration_files() -> (std::path::PathBuf, Vec<String>) {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
        let mut names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".sql"))
            .collect();
        names.sort();
        (dir, names)
    }

    async fn run_migration_file(pool: &SqlitePool, dir: &std::path::Path, name: &str) {
        let sql = std::fs::read_to_string(dir.join(name)).unwrap();
        sqlx::raw_sql(&sql)
            .execute(pool)
            .await
            .unwrap_or_else(|e| panic!("migration {name} failed: {e}"));
    }

    /// Apply migrations in order, stopping after the one prefixed `through`. Lets a
    /// test stand up an older schema and then step it forward one migration at a
    /// time, which `sqlx::migrate!` (all-or-nothing) can't express.
    async fn migrate_through(pool: &SqlitePool, through: &str) {
        let (dir, names) = migration_files();
        for name in names {
            run_migration_file(pool, &dir, &name).await;
            if name.starts_with(through) {
                return;
            }
        }
        panic!("no migration starting with {through}");
    }

    /// Apply exactly one migration, by filename prefix.
    async fn apply_migration(pool: &SqlitePool, prefix: &str) {
        let (dir, names) = migration_files();
        let name = names
            .iter()
            .find(|n| n.starts_with(prefix))
            .unwrap_or_else(|| panic!("no migration starting with {prefix}"));
        run_migration_file(pool, &dir, name).await;
    }

    /// Upgrading with a docs repo already configured must keep both the repo and
    /// its synced cache — a resync costs one API call per markdown file.
    #[tokio::test]
    async fn docs_sources_migration_carries_the_legacy_repo_forward() {
        let dir = tempfile::tempdir().unwrap();
        let opts = SqliteConnectOptions::new()
            .filename(dir.path().join("legacy.db"))
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new().connect_with(opts).await.unwrap();

        migrate_through(&pool, "0015").await;
        for (k, v) in [
            ("docs_repo_owner", "acme"),
            ("docs_repo_name", "core-docs"),
            ("docs_repo_branch", "release"),
        ] {
            save_setting(&pool, k, v).await.unwrap();
        }
        sqlx::query(
            "INSERT INTO docs_files (path, name, kind, parent_path, sha, content, synced_at)
             VALUES ('README.md', 'README.md', 'blob', '', 'sha1', '# Hi', 'yesterday')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO docs_sync_meta (id, last_synced_at, file_count, tree_sha, truncated)
             VALUES (1, 'yesterday', 1, 'tree1', 0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        apply_migration(&pool, "0016").await;

        let sources = docs::list_docs_sources(&pool).await.unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].id, "acme/core-docs@release");
        assert_eq!(sources[0].name, "core-docs"); // defaults to the repo name
        assert_eq!(sources[0].branch, "release");
        // The cache came along rather than being dropped.
        assert_eq!(sources[0].file_count, 1);
        assert_eq!(sources[0].last_synced_at.as_deref(), Some("yesterday"));
        assert_eq!(
            docs::load_doc_content(&pool, &sources[0].id, "README.md")
                .await
                .unwrap()
                .as_deref(),
            Some("# Hi")
        );
        // The superseded settings keys are gone.
        assert_eq!(load_setting(&pool, "docs_repo_owner").await.unwrap(), None);
    }

    /// The same upgrade on a install that never configured a repo must leave an
    /// empty source list, not a half-built row from NULL settings.
    #[tokio::test]
    async fn docs_sources_migration_is_a_noop_without_a_legacy_repo() {
        let dir = tempfile::tempdir().unwrap();
        let opts = SqliteConnectOptions::new()
            .filename(dir.path().join("fresh.db"))
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new().connect_with(opts).await.unwrap();

        migrate_through(&pool, "0015").await;
        apply_migration(&pool, "0016").await;

        assert!(docs::list_docs_sources(&pool).await.unwrap().is_empty());
    }
}
