use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::Path;

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

pub async fn save_viewer_name(pool: &SqlitePool, name: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(VIEWER_NAME_KEY)
    .bind(name)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn load_viewer_name(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?1")
        .bind(VIEWER_NAME_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.0))
}

pub async fn clear_viewer_name(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM settings WHERE key = ?1")
        .bind(VIEWER_NAME_KEY)
        .execute(pool)
        .await?;
    Ok(())
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
    async fn viewer_name_roundtrip_and_clear() {
        let (_dir, pool) = temp_pool().await;
        assert_eq!(load_viewer_name(&pool).await.unwrap(), None);
        save_viewer_name(&pool, "Abrar").await.unwrap();
        assert_eq!(
            load_viewer_name(&pool).await.unwrap(),
            Some("Abrar".to_string())
        );
        save_viewer_name(&pool, "Abrar 2").await.unwrap(); // upsert
        assert_eq!(
            load_viewer_name(&pool).await.unwrap(),
            Some("Abrar 2".to_string())
        );
        clear_viewer_name(&pool).await.unwrap();
        assert_eq!(load_viewer_name(&pool).await.unwrap(), None);
    }
}
