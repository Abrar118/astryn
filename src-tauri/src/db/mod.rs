use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::Path;

pub mod issues;

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
// These fns are pub API for future command wrappers; suppress until wired.
#[allow(dead_code)]
const VIEWER_ID_KEY: &str = "linear_viewer_id";
#[allow(dead_code)]
const ORG_ID_KEY: &str = "linear_org_id";
#[allow(dead_code)]
const ORG_NAME_KEY: &str = "linear_org_name";
#[allow(dead_code)]
const ORG_URL_KEY_KEY: &str = "linear_org_url_key";

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
#[allow(dead_code)]
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

#[allow(dead_code)]
pub async fn load_org_id(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    load_setting(pool, ORG_ID_KEY).await
}

/// (viewer_id, viewer_name) if both are cached.
#[allow(dead_code)]
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
}
