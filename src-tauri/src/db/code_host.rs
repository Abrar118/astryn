//! Provider-neutral PR scope cache. Each code-host provider owns its own pair of
//! tables with identical columns (`github_prs`/`github_sync_meta`,
//! `bitbucket_prs`/`bitbucket_sync_meta`) and its own favorites setting; these
//! functions take a `PrTables` naming them. Table names are compile-time
//! constants, never user input, so formatting them into SQL is safe.

use sqlx::SqlitePool;

use crate::code_host::{parse_repo_name, ParsedPr, RepositoryName, Reviewer};

#[derive(Debug, Clone, Copy)]
pub struct PrTables {
    pub prs: &'static str,
    pub meta: &'static str,
    pub favorites_key: &'static str,
}

pub const GITHUB: PrTables = PrTables {
    prs: "github_prs",
    meta: "github_sync_meta",
    favorites_key: "github_favorite_repos",
};

pub const BITBUCKET: PrTables = PrTables {
    prs: "bitbucket_prs",
    meta: "bitbucket_sync_meta",
    favorites_key: "bitbucket_favorite_repos",
};

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
    pub base_branch: Option<String>,
    pub url: Option<String>,
    pub linear_identifier: Option<String>,
    pub linear_issue_id: Option<String>,
    pub updated_at: Option<String>,
    pub merged_at: Option<String>,
    pub additions: Option<i64>,
    pub deletions: Option<i64>,
    pub changed_files: Option<i64>,
    // Linear issue state, resolved via the read-time join (nullable).
    pub linear_state_name: Option<String>,
    pub linear_state_type: Option<String>,
    pub linear_state_color: Option<String>,
    pub linear_priority: Option<i64>,
    // Raw reviewers JSON from the column; parsed into `reviewers` after the query.
    #[serde(skip)]
    #[sqlx(rename = "reviewers")]
    pub reviewers_raw: Option<String>,
    #[sqlx(skip)]
    pub reviewers: Vec<Reviewer>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SyncMeta {
    pub bucket: String,
    pub fetched_count: i64,
    pub truncated: bool,
    pub last_synced_at: Option<String>,
}

/// Atomically replace one scope's cached rows and its sync metadata: delete the
/// scope, insert the fetched set, upsert the meta — all in one transaction so a
/// partial write never empties the scope.
pub async fn replace_scope(
    pool: &SqlitePool,
    t: PrTables,
    bucket: &str,
    prs: &[ParsedPr],
    synced_at: &str,
    truncated: bool,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query(&format!("DELETE FROM {} WHERE bucket = ?1", t.prs))
        .bind(bucket)
        .execute(&mut *tx)
        .await?;
    let insert = format!(
        "INSERT INTO {}
           (id, bucket, repo, number, title, draft, mergeable, ci_status, review_decision,
            author_login, author_avatar, comment_count, branch, base_branch, url,
            linear_identifier, updated_at, synced_at, merged_at, additions, deletions,
            changed_files, reviewers)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)",
        t.prs
    );
    for p in prs {
        sqlx::query(&insert)
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
            .bind(&p.base_branch)
            .bind(&p.url)
            .bind(&p.linear_identifier)
            .bind(&p.updated_at)
            .bind(synced_at)
            .bind(&p.merged_at)
            .bind(p.additions)
            .bind(p.deletions)
            .bind(p.changed_files)
            .bind(serde_json::to_string(&p.reviewers).ok())
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query(&format!(
        "INSERT INTO {} (bucket, fetched_count, truncated, last_synced_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(bucket) DO UPDATE SET
           fetched_count = excluded.fetched_count,
           truncated = excluded.truncated,
           last_synced_at = excluded.last_synced_at",
        t.meta
    ))
    .bind(bucket)
    .bind(prs.len() as i64)
    .bind(truncated)
    .bind(synced_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn list_rows(
    pool: &SqlitePool,
    t: PrTables,
    include_tracker: bool,
) -> Result<Vec<PrRow>, sqlx::Error> {
    // Without the tracker module the issues cache is not joined at all.
    let (linear_cols, linear_join) = if include_tracker {
        (
            "i.id AS linear_issue_id, i.state_name AS linear_state_name,
                i.state_type AS linear_state_type, i.state_color AS linear_state_color,
                i.priority AS linear_priority",
            "LEFT JOIN issues i ON i.identifier = p.linear_identifier",
        )
    } else {
        (
            "NULL AS linear_issue_id, NULL AS linear_state_name,
                NULL AS linear_state_type, NULL AS linear_state_color,
                NULL AS linear_priority",
            "",
        )
    };
    let sql = format!(
        "SELECT p.id, p.bucket, p.repo, p.number, p.title, p.draft, p.mergeable, p.ci_status,
                p.review_decision, p.author_login, p.author_avatar, p.comment_count, p.branch,
                p.base_branch, p.url, p.linear_identifier, p.updated_at,
                p.merged_at, p.additions, p.deletions, p.changed_files,
                {linear_cols},
                p.reviewers
         FROM {} p
         {linear_join}
         ORDER BY p.bucket, p.updated_at DESC",
        t.prs
    );
    let mut rows = sqlx::query_as::<_, PrRow>(&sql).fetch_all(pool).await?;
    for r in &mut rows {
        if let Some(json) = &r.reviewers_raw {
            r.reviewers = serde_json::from_str(json).unwrap_or_default();
        }
    }
    Ok(rows)
}

pub async fn load_meta(pool: &SqlitePool, t: PrTables) -> Result<Vec<SyncMeta>, sqlx::Error> {
    sqlx::query_as::<_, SyncMeta>(&format!(
        "SELECT bucket, fetched_count, truncated, last_synced_at FROM {}",
        t.meta
    ))
    .fetch_all(pool)
    .await
}

pub async fn load_favorites(pool: &SqlitePool, t: PrTables) -> Result<Vec<String>, sqlx::Error> {
    let Some(json) = crate::db::load_setting(pool, t.favorites_key).await? else {
        return Ok(Vec::new());
    };
    let values: Vec<String> = serde_json::from_str(&json).unwrap_or_default();
    let mut favorites = Vec::new();
    for value in values {
        let Some(repo) = parse_repo_name(&value) else {
            continue;
        };
        if !favorites
            .iter()
            .any(|known: &String| known.eq_ignore_ascii_case(&repo.canonical))
        {
            favorites.push(repo.canonical);
        }
    }
    favorites.sort_by_key(|repo| repo.to_ascii_lowercase());
    Ok(favorites)
}

/// Add or remove a favorite; removing also deletes its re-fetchable repo scope.
pub async fn set_favorite(
    pool: &SqlitePool,
    t: PrTables,
    repo: &RepositoryName,
    favorite: bool,
) -> Result<Vec<String>, sqlx::Error> {
    let mut favorites = load_favorites(pool, t).await?;
    if favorite {
        if !favorites
            .iter()
            .any(|known| known.eq_ignore_ascii_case(&repo.canonical))
        {
            favorites.push(repo.canonical.clone());
        }
    } else {
        favorites.retain(|known| !known.eq_ignore_ascii_case(&repo.canonical));
    }
    favorites.sort_by_key(|known| known.to_ascii_lowercase());
    let json = serde_json::to_string(&favorites).unwrap_or_else(|_| "[]".to_string());

    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(t.favorites_key)
    .bind(json)
    .execute(&mut *tx)
    .await?;
    if !favorite {
        sqlx::query(&format!("DELETE FROM {} WHERE bucket = ?1", t.prs))
            .bind(&repo.scope)
            .execute(&mut *tx)
            .await?;
        sqlx::query(&format!("DELETE FROM {} WHERE bucket = ?1", t.meta))
            .bind(&repo.scope)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(favorites)
}
