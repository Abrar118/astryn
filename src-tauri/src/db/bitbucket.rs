use sqlx::SqlitePool;

use super::code_host::BITBUCKET;

pub const BITBUCKET_LOGIN_KEY: &str = "bitbucket_login";

/// Drop all Bitbucket cache state (rows, meta, cached login, favorites). Leaves
/// every other provider alone.
pub async fn wipe_bitbucket_cache(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM bitbucket_prs")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM bitbucket_sync_meta")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM settings WHERE key IN (?1, ?2)")
        .bind(BITBUCKET_LOGIN_KEY)
        .bind(BITBUCKET.favorites_key)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

pub async fn save_login(pool: &SqlitePool, login: &str) -> Result<(), sqlx::Error> {
    crate::db::save_setting(pool, BITBUCKET_LOGIN_KEY, login).await
}

pub async fn load_login(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    crate::db::load_setting(pool, BITBUCKET_LOGIN_KEY).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::code_host::{parse_repo_name, ParsedPr};
    use crate::db::code_host as ch;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    fn pr(n: i64) -> ParsedPr {
        ParsedPr {
            id: format!("ws/repo#{n}"),
            repo: "ws/repo".into(),
            number: n,
            title: Some("t".into()),
            draft: false,
            mergeable: Some("unknown".into()),
            ci_status: Some("none".into()),
            review_decision: None,
            author_login: Some("me".into()),
            author_avatar: None,
            comment_count: Some(0),
            branch: Some("feature".into()),
            base_branch: Some("main".into()),
            url: Some("u".into()),
            linear_identifier: None,
            updated_at: Some("2026-10-28T00:00:00Z".into()),
            merged_at: None,
            additions: None,
            deletions: None,
            changed_files: None,
            reviewers: Vec::new(),
        }
    }

    #[tokio::test]
    async fn bitbucket_scopes_are_isolated_from_github() {
        let (_d, pool) = pool().await;
        ch::replace_scope(&pool, BITBUCKET, "mine", &[pr(1)], "now", false)
            .await
            .unwrap();
        assert_eq!(
            ch::list_rows(&pool, BITBUCKET, true).await.unwrap().len(),
            1
        );
        assert!(crate::db::github::list_prs(&pool, true)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn wipe_clears_rows_meta_login_and_favorites_only() {
        let (_d, pool) = pool().await;
        ch::replace_scope(&pool, BITBUCKET, "mine", &[pr(1)], "now", false)
            .await
            .unwrap();
        ch::set_favorite(&pool, BITBUCKET, &parse_repo_name("ws/repo").unwrap(), true)
            .await
            .unwrap();
        save_login(&pool, "me").await.unwrap();
        crate::db::github::save_github_login(&pool, "octocat")
            .await
            .unwrap();

        wipe_bitbucket_cache(&pool).await.unwrap();

        assert!(ch::list_rows(&pool, BITBUCKET, true)
            .await
            .unwrap()
            .is_empty());
        assert!(ch::load_meta(&pool, BITBUCKET).await.unwrap().is_empty());
        assert!(ch::load_favorites(&pool, BITBUCKET)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(load_login(&pool).await.unwrap(), None);
        assert_eq!(
            crate::db::github::load_github_login(&pool)
                .await
                .unwrap()
                .as_deref(),
            Some("octocat")
        );
    }
}
