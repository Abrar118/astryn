use sqlx::SqlitePool;

use crate::github::repositories::RepositoryName;

use super::code_host::{self as ch, GITHUB};
pub use super::code_host::{PrRow, SyncMeta};

pub const GITHUB_LOGIN_KEY: &str = "github_login";
pub const GITHUB_CONTRIBUTIONS_KEY: &str = "github_contributions";
pub const GITHUB_FAVORITE_REPOS_KEY: &str = "github_favorite_repos";

/// Atomically replace one bucket's cached rows and its sync metadata (one
/// transaction, so a partial write never empties the bucket).
pub async fn replace_bucket(
    pool: &SqlitePool,
    bucket: &str,
    prs: &[crate::github::prs::ParsedPr],
    synced_at: &str,
    truncated: bool,
) -> Result<(), sqlx::Error> {
    ch::replace_scope(pool, GITHUB, bucket, prs, synced_at, truncated).await
}

/// Drop all GitHub cache state (rows + meta + cached login). Leaves Linear alone.
/// The docs cache shares the GitHub credential (private repo content), so it is
/// wiped on the same seam as the PR cache.
pub async fn wipe_github_cache(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM github_prs")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM github_sync_meta")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM settings WHERE key IN (?1, ?2, ?3)")
        .bind(GITHUB_LOGIN_KEY)
        .bind(GITHUB_CONTRIBUTIONS_KEY)
        .bind(GITHUB_FAVORITE_REPOS_KEY)
        .execute(&mut *tx)
        .await?;
    // The GitHub-repo docs cache shares the GitHub credential, so it is wiped on
    // the same seam as the PR cache. Other source kinds are not GitHub data.
    for table in ["docs_files", "docs_sync_meta"] {
        sqlx::query(&format!(
            "DELETE FROM {table} WHERE source_id IN
               (SELECT id FROM docs_sources WHERE kind = 'github')"
        ))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn save_github_login(pool: &SqlitePool, login: &str) -> Result<(), sqlx::Error> {
    crate::db::save_setting(pool, GITHUB_LOGIN_KEY, login).await
}

pub async fn load_github_login(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    crate::db::load_setting(pool, GITHUB_LOGIN_KEY).await
}

/// The contribution calendar is cached as a JSON blob in `settings` (one row),
/// so it survives restart (offline-first) without a dedicated table.
pub async fn save_contributions_json(pool: &SqlitePool, json: &str) -> Result<(), sqlx::Error> {
    crate::db::save_setting(pool, GITHUB_CONTRIBUTIONS_KEY, json).await
}

pub async fn load_contributions_json(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    crate::db::load_setting(pool, GITHUB_CONTRIBUTIONS_KEY).await
}

pub async fn load_favorite_repos(pool: &SqlitePool) -> Result<Vec<String>, sqlx::Error> {
    ch::load_favorites(pool, GITHUB).await
}

pub async fn set_favorite_repo(
    pool: &SqlitePool,
    repo: &RepositoryName,
    favorite: bool,
) -> Result<Vec<String>, sqlx::Error> {
    ch::set_favorite(pool, GITHUB, repo, favorite).await
}

pub async fn list_prs(pool: &SqlitePool, include_tracker: bool) -> Result<Vec<PrRow>, sqlx::Error> {
    ch::list_rows(pool, GITHUB, include_tracker).await
}

pub async fn load_sync_meta(pool: &SqlitePool) -> Result<Vec<SyncMeta>, sqlx::Error> {
    ch::load_meta(pool, GITHUB).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::prs::{ParsedPr, Reviewer};
    use crate::github::repositories::parse_repository;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
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
            base_branch: Some("main".into()),
            url: Some("u".into()),
            linear_identifier: ident.map(|s| s.to_string()),
            updated_at: Some("2026-06-20T00:00:00Z".into()),
            merged_at: None,
            additions: Some(10),
            deletions: Some(2),
            changed_files: Some(3),
            reviewers: vec![Reviewer {
                login: "rev".into(),
                avatar: None,
                state: "approved".into(),
            }],
        }
    }

    #[tokio::test]
    async fn replace_bucket_upserts_and_prunes() {
        let (_d, pool) = pool().await;
        replace_bucket(&pool, "mine", &[pr(1, None), pr(2, None)], "now", false)
            .await
            .unwrap();
        replace_bucket(&pool, "mine", &[pr(2, None)], "now", true)
            .await
            .unwrap();
        let rows = list_prs(&pool, true).await.unwrap();
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
        replace_bucket(
            &pool,
            "mine",
            &[pr(9, Some("ENG-9")), pr(8, Some("ZZZ-1"))],
            "now",
            false,
        )
        .await
        .unwrap();
        let rows = list_prs(&pool, true).await.unwrap();
        let matched = rows.iter().find(|r| r.number == 9).unwrap();
        let unmatched = rows.iter().find(|r| r.number == 8).unwrap();
        assert_eq!(matched.linear_issue_id.as_deref(), Some("iss-1"));
        assert_eq!(unmatched.linear_issue_id, None);
    }

    #[tokio::test]
    async fn list_prs_without_tracker_has_no_linear_fields() {
        let (_d, pool) = pool().await;
        sqlx::query("INSERT INTO issues (id, identifier, title, url, state_name, state_type, state_color, priority, created_at, updated_at, synced_at) VALUES ('iss-1','ENG-1','x','u','Todo','unstarted','#fff',2,'t','t','t')")
            .execute(&pool).await.unwrap();
        replace_bucket(&pool, "mine", &[pr(1, Some("ENG-1"))], "now", false)
            .await
            .unwrap();
        let off = list_prs(&pool, false).await.unwrap();
        assert_eq!(off[0].linear_issue_id, None);
        assert_eq!(off[0].linear_state_name, None);
        assert_eq!(off[0].linear_priority, None);
        let on = list_prs(&pool, true).await.unwrap();
        assert_eq!(on[0].linear_issue_id.as_deref(), Some("iss-1"));
        assert_eq!(on[0].linear_state_name.as_deref(), Some("Todo"));
    }

    #[tokio::test]
    async fn favorite_repositories_round_trip_and_dedupe_case_insensitively() {
        let (_d, pool) = pool().await;
        set_favorite_repo(&pool, &parse_repository("Owner/Repo").unwrap(), true)
            .await
            .unwrap();
        set_favorite_repo(&pool, &parse_repository("owner/repo").unwrap(), true)
            .await
            .unwrap();
        set_favorite_repo(&pool, &parse_repository("Another/Project").unwrap(), true)
            .await
            .unwrap();

        assert_eq!(
            load_favorite_repos(&pool).await.unwrap(),
            vec!["Another/Project", "Owner/Repo"]
        );
    }

    #[tokio::test]
    async fn malformed_favorite_setting_recovers_as_empty() {
        let (_d, pool) = pool().await;
        crate::db::save_setting(&pool, GITHUB_FAVORITE_REPOS_KEY, "{bad json")
            .await
            .unwrap();

        assert!(load_favorite_repos(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn removing_favorite_deletes_only_its_repository_scope() {
        let (_d, pool) = pool().await;
        set_favorite_repo(&pool, &parse_repository("Owner/Repo").unwrap(), true)
            .await
            .unwrap();
        replace_bucket(&pool, "repo:owner/repo", &[pr(1, None)], "now", false)
            .await
            .unwrap();
        replace_bucket(&pool, "mine", &[pr(2, None)], "now", false)
            .await
            .unwrap();

        set_favorite_repo(&pool, &parse_repository("owner/repo").unwrap(), false)
            .await
            .unwrap();

        let rows = list_prs(&pool, true).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].bucket, "mine");
        let meta = load_sync_meta(&pool).await.unwrap();
        assert_eq!(meta.len(), 1);
        assert_eq!(meta[0].bucket, "mine");
        assert!(load_favorite_repos(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn wipe_clears_prs_meta_and_login() {
        let (_d, pool) = pool().await;
        replace_bucket(&pool, "mine", &[pr(1, None)], "now", false)
            .await
            .unwrap();
        save_github_login(&pool, "octocat").await.unwrap();
        set_favorite_repo(&pool, &parse_repository("Owner/Repo").unwrap(), true)
            .await
            .unwrap();
        // Docs cache shares the GitHub credential, so every source's content must
        // be wiped too — while the configured sources themselves (user config, not
        // credential-derived) survive so a new token just resyncs them.
        crate::db::docs::insert_docs_source(&pool, "Core", "acme", "core", "main", "now")
            .await
            .unwrap();
        let source = crate::db::docs::source_id("acme", "core", "main");
        crate::db::docs::replace_docs(
            &pool,
            &source,
            &[crate::db::docs::DocFile {
                path: "a.md".into(),
                name: "a.md".into(),
                kind: "blob".into(),
                parent_path: "".into(),
                sha: "s".into(),
                content: Some("a".into()),
            }],
            "now",
            None,
            false,
        )
        .await
        .unwrap();
        // A local folder's scan metadata is not GitHub data and must survive.
        crate::db::docs::insert_local_docs_source(&pool, "Notes", "/notes", "now")
            .await
            .unwrap();
        let local = crate::db::docs::local_source_id("/notes");
        crate::db::docs::write_scan_meta(&pool, &local, "now", 3, false)
            .await
            .unwrap();
        wipe_github_cache(&pool).await.unwrap();
        assert!(list_prs(&pool, true).await.unwrap().is_empty());
        assert!(load_sync_meta(&pool).await.unwrap().is_empty());
        assert_eq!(load_github_login(&pool).await.unwrap(), None);
        assert!(load_favorite_repos(&pool).await.unwrap().is_empty());
        assert!(crate::db::docs::list_docs(&pool, &source)
            .await
            .unwrap()
            .is_empty());
        let sources = crate::db::docs::list_docs_sources(&pool).await.unwrap();
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].last_synced_at, None);
        assert_eq!(sources[1].file_count, 3);
    }
}
