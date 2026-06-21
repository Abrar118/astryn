use sqlx::SqlitePool;

use crate::github::prs::ParsedPr;

pub const GITHUB_LOGIN_KEY: &str = "github_login";

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PrRow {
    pub id: String,
    pub bucket: String,
    pub repo: String,
    pub number: i64,
    pub title: Option<String>,
    pub draft: bool,
    pub mergeable: Option<String>,
    pub ci_status: Option<String>,
    pub review_decision: Option<String>,
    pub author_login: Option<String>,
    pub author_avatar: Option<String>,
    pub comment_count: Option<i64>,
    pub branch: Option<String>,
    pub url: Option<String>,
    pub linear_identifier: Option<String>,
    pub linear_issue_id: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SyncMeta {
    pub bucket: String,
    pub fetched_count: i64,
    pub truncated: bool,
    pub last_synced_at: Option<String>,
}

/// Atomically replace one bucket's cached rows and its sync metadata: delete the
/// bucket, insert the fetched set, upsert the meta — all in one transaction so a
/// partial write never empties the bucket.
pub async fn replace_bucket(
    pool: &SqlitePool,
    bucket: &str,
    prs: &[ParsedPr],
    synced_at: &str,
    truncated: bool,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM github_prs WHERE bucket = ?1")
        .bind(bucket)
        .execute(&mut *tx)
        .await?;
    for p in prs {
        sqlx::query(
            "INSERT INTO github_prs
               (id, bucket, repo, number, title, draft, mergeable, ci_status, review_decision,
                author_login, author_avatar, comment_count, branch, url, linear_identifier,
                updated_at, synced_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
        )
        .bind(&p.id)
        .bind(bucket)
        .bind(&p.repo)
        .bind(p.number)
        .bind(&p.title)
        .bind(p.draft)
        .bind(&p.mergeable)
        .bind(&p.ci_status)
        .bind(&p.review_decision)
        .bind(&p.author_login)
        .bind(&p.author_avatar)
        .bind(p.comment_count)
        .bind(&p.branch)
        .bind(&p.url)
        .bind(&p.linear_identifier)
        .bind(&p.updated_at)
        .bind(synced_at)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "INSERT INTO github_sync_meta (bucket, fetched_count, truncated, last_synced_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(bucket) DO UPDATE SET
           fetched_count = excluded.fetched_count,
           truncated = excluded.truncated,
           last_synced_at = excluded.last_synced_at",
    )
    .bind(bucket)
    .bind(prs.len() as i64)
    .bind(truncated)
    .bind(synced_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Drop all GitHub cache state (rows + meta + cached login). Leaves Linear alone.
pub async fn wipe_github_cache(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM github_prs").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM github_sync_meta").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM settings WHERE key = ?1")
        .bind(GITHUB_LOGIN_KEY)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn save_github_login(pool: &SqlitePool, login: &str) -> Result<(), sqlx::Error> {
    crate::db::save_setting(pool, GITHUB_LOGIN_KEY, login).await
}

pub async fn load_github_login(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    crate::db::load_setting(pool, GITHUB_LOGIN_KEY).await
}

pub async fn list_prs(pool: &SqlitePool) -> Result<Vec<PrRow>, sqlx::Error> {
    sqlx::query_as::<_, PrRow>(
        "SELECT p.id, p.bucket, p.repo, p.number, p.title, p.draft, p.mergeable, p.ci_status,
                p.review_decision, p.author_login, p.author_avatar, p.comment_count, p.branch,
                p.url, p.linear_identifier, i.id AS linear_issue_id, p.updated_at
         FROM github_prs p
         LEFT JOIN issues i ON i.identifier = p.linear_identifier
         ORDER BY p.bucket, p.updated_at DESC",
    )
    .fetch_all(pool)
    .await
}

pub async fn load_sync_meta(pool: &SqlitePool) -> Result<Vec<SyncMeta>, sqlx::Error> {
    sqlx::query_as::<_, SyncMeta>(
        "SELECT bucket, fetched_count, truncated, last_synced_at FROM github_sync_meta",
    )
    .fetch_all(pool)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db")).await.unwrap();
        (dir, pool)
    }

    fn pr(id_num: i64, ident: Option<&str>) -> ParsedPr {
        ParsedPr {
            id: format!("o/r#{id_num}"),
            repo: "o/r".into(),
            number: id_num,
            title: Some("t".into()),
            draft: false,
            mergeable: Some("mergeable".into()),
            ci_status: Some("success".into()),
            review_decision: None,
            author_login: Some("octocat".into()),
            author_avatar: None,
            comment_count: Some(1),
            branch: Some("b".into()),
            url: Some("u".into()),
            linear_identifier: ident.map(|s| s.to_string()),
            updated_at: Some("2026-06-20T00:00:00Z".into()),
        }
    }

    #[tokio::test]
    async fn replace_bucket_upserts_and_prunes() {
        let (_d, pool) = pool().await;
        replace_bucket(&pool, "mine", &[pr(1, None), pr(2, None)], "now", false).await.unwrap();
        replace_bucket(&pool, "mine", &[pr(2, None)], "now", true).await.unwrap();
        let rows = list_prs(&pool).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].number, 2);
        let meta = load_sync_meta(&pool).await.unwrap();
        assert_eq!(meta.len(), 1);
        assert_eq!(meta[0].truncated, true);
        assert_eq!(meta[0].fetched_count, 1);
    }

    #[tokio::test]
    async fn list_prs_joins_linear_issue_id() {
        let (_d, pool) = pool().await;
        sqlx::query("INSERT INTO issues (id, identifier, title, url, created_at, updated_at, synced_at) VALUES ('iss-1','ENG-9','x','u','t','t','t')")
            .execute(&pool).await.unwrap();
        replace_bucket(&pool, "mine", &[pr(9, Some("ENG-9")), pr(8, Some("ZZZ-1"))], "now", false).await.unwrap();
        let rows = list_prs(&pool).await.unwrap();
        let matched = rows.iter().find(|r| r.number == 9).unwrap();
        let unmatched = rows.iter().find(|r| r.number == 8).unwrap();
        assert_eq!(matched.linear_issue_id.as_deref(), Some("iss-1"));
        assert_eq!(unmatched.linear_issue_id, None);
    }

    #[tokio::test]
    async fn wipe_clears_prs_meta_and_login() {
        let (_d, pool) = pool().await;
        replace_bucket(&pool, "mine", &[pr(1, None)], "now", false).await.unwrap();
        save_github_login(&pool, "octocat").await.unwrap();
        wipe_github_cache(&pool).await.unwrap();
        assert!(list_prs(&pool).await.unwrap().is_empty());
        assert!(load_sync_meta(&pool).await.unwrap().is_empty());
        assert_eq!(load_github_login(&pool).await.unwrap(), None);
    }
}
