use sqlx::SqlitePool;

#[derive(Debug, Clone)]
pub struct DocFile {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub parent_path: String,
    pub sha: String,
    pub content: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DocNode {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub parent_path: String,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DocsMeta {
    pub last_synced_at: Option<String>,
    pub file_count: i64,
    pub truncated: bool,
}

/// Replace the entire docs cache (delete all rows, insert the fetched set) and
/// upsert the single metadata row, in one transaction so a partial write never
/// leaves a half-empty tree.
pub async fn replace_docs(
    pool: &SqlitePool,
    files: &[DocFile],
    synced_at: &str,
    tree_sha: Option<&str>,
    truncated: bool,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM docs_files").execute(&mut *tx).await?;
    for f in files {
        sqlx::query(
            "INSERT INTO docs_files (path, name, kind, parent_path, sha, content, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(&f.path)
        .bind(&f.name)
        .bind(&f.kind)
        .bind(&f.parent_path)
        .bind(&f.sha)
        .bind(&f.content)
        .bind(synced_at)
        .execute(&mut *tx)
        .await?;
    }
    let file_count = files.iter().filter(|f| f.kind == "blob").count() as i64;
    sqlx::query(
        "INSERT INTO docs_sync_meta (id, last_synced_at, file_count, tree_sha, truncated)
         VALUES (1, ?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           last_synced_at = excluded.last_synced_at,
           file_count     = excluded.file_count,
           tree_sha       = excluded.tree_sha,
           truncated      = excluded.truncated",
    )
    .bind(synced_at)
    .bind(file_count)
    .bind(tree_sha)
    .bind(truncated)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// All cached entries (folders + files), lightweight (no content). The frontend
/// nests them into a tree.
pub async fn list_docs(pool: &SqlitePool) -> Result<Vec<DocNode>, sqlx::Error> {
    sqlx::query_as::<_, DocNode>(
        "SELECT path, name, kind, parent_path FROM docs_files ORDER BY path",
    )
    .fetch_all(pool)
    .await
}

/// The cached markdown for one file (`None` if the path is unknown or a folder).
pub async fn load_doc_content(pool: &SqlitePool, path: &str) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT content FROM docs_files WHERE path = ?1 AND kind = 'blob'")
            .bind(path)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|r| r.0))
}

/// The single sync-metadata row (`None` before the first sync).
pub async fn load_docs_meta(pool: &SqlitePool) -> Result<Option<DocsMeta>, sqlx::Error> {
    sqlx::query_as::<_, DocsMeta>(
        "SELECT last_synced_at, file_count, truncated FROM docs_sync_meta WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
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

    fn dir(path: &str, parent: &str) -> DocFile {
        DocFile {
            path: path.into(),
            name: path.rsplit('/').next().unwrap().into(),
            kind: "tree".into(),
            parent_path: parent.into(),
            sha: "s".into(),
            content: None,
        }
    }

    fn file(path: &str, parent: &str, body: &str) -> DocFile {
        DocFile {
            path: path.into(),
            name: path.rsplit('/').next().unwrap().into(),
            kind: "blob".into(),
            parent_path: parent.into(),
            sha: "s".into(),
            content: Some(body.into()),
        }
    }

    #[tokio::test]
    async fn replace_docs_stores_tree_and_meta() {
        let (_d, pool) = pool().await;
        let files = vec![
            dir("02-technical", ""),
            file("02-technical/README.md", "02-technical", "# Tech"),
            file("README.md", "", "# Root"),
        ];
        replace_docs(&pool, &files, "now", Some("treesha"), false)
            .await
            .unwrap();

        let nodes = list_docs(&pool).await.unwrap();
        assert_eq!(nodes.len(), 3);

        assert_eq!(
            load_doc_content(&pool, "02-technical/README.md")
                .await
                .unwrap()
                .as_deref(),
            Some("# Tech")
        );
        // Folders carry no content.
        assert_eq!(load_doc_content(&pool, "02-technical").await.unwrap(), None);

        let meta = load_docs_meta(&pool).await.unwrap().unwrap();
        assert_eq!(meta.file_count, 2); // two blobs
        assert_eq!(meta.truncated, false);
        assert_eq!(meta.last_synced_at.as_deref(), Some("now"));
    }

    #[tokio::test]
    async fn replace_docs_prunes_old_entries() {
        let (_d, pool) = pool().await;
        replace_docs(&pool, &[file("a.md", "", "a")], "t1", None, false)
            .await
            .unwrap();
        replace_docs(&pool, &[file("b.md", "", "b")], "t2", None, true)
            .await
            .unwrap();
        let nodes = list_docs(&pool).await.unwrap();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].path, "b.md");
        // Stale file is gone, meta updated (single row).
        assert_eq!(load_doc_content(&pool, "a.md").await.unwrap(), None);
        assert_eq!(load_docs_meta(&pool).await.unwrap().unwrap().truncated, true);
    }

    #[tokio::test]
    async fn meta_is_none_before_first_sync() {
        let (_d, pool) = pool().await;
        assert!(load_docs_meta(&pool).await.unwrap().is_none());
        assert!(list_docs(&pool).await.unwrap().is_empty());
    }
}
