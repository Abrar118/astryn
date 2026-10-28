//! Provider-neutral code-host data shapes. Every code-host provider (GitHub,
//! Bitbucket) parses its own wire format into these, so the cache, the Tauri
//! payloads and the PR workspace UI are shared.

use serde::Serialize;

/// One reviewer's relationship to a PR: an opinionated review (approved /
/// changes_requested / commented) or a still-pending requested review.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Reviewer {
    pub login: String,
    pub avatar: Option<String>,
    pub state: String, // approved | changes_requested | commented | dismissed | pending
}

#[derive(Debug, Clone)]
pub struct ParsedPr {
    pub id: String,
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
    pub updated_at: Option<String>,
    pub merged_at: Option<String>,
    pub additions: Option<i64>,
    pub deletions: Option<i64>,
    pub changed_files: Option<i64>,
    pub reviewers: Vec<Reviewer>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryCatalog {
    pub repositories: Vec<String>,
    pub truncated: bool,
}

/// A validated `owner/name` repository (GitHub owner/repo, Bitbucket
/// workspace/slug). `scope` is the lowercase cache scope key `repo:<owner/name>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryName {
    pub canonical: String,
    pub owner: String,
    pub name: String,
    pub scope: String,
}

/// Strictly validate `owner/name`: exactly two non-empty parts of ASCII
/// alphanumerics, `_`, `-`, `.` (but not only dots, so `..` can never become a
/// path segment) — safe to place in an API path unescaped.
pub fn parse_repo_name(input: &str) -> Option<RepositoryName> {
    let canonical = input.trim();
    let (owner, name) = canonical.split_once('/')?;
    let valid = |part: &str| {
        !part.is_empty()
            && !part.bytes().all(|b| b == b'.')
            && part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
    };
    if !valid(owner) || !valid(name) {
        return None;
    }
    Some(RepositoryName {
        canonical: canonical.to_string(),
        owner: owner.to_string(),
        name: name.to_string(),
        scope: format!("repo:{}", canonical.to_ascii_lowercase()),
    })
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrDetailComment {
    pub id: String,
    pub body: String,
    pub created_at: String,
    pub url: String,
    pub author_login: Option<String>,
    pub author_avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrDetailReview {
    pub id: String,
    pub body: String,
    pub state: String,
    pub submitted_at: String,
    pub url: String,
    pub author_login: Option<String>,
    pub author_avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrDetailCommit {
    pub oid: String,
    pub headline: String,
    pub committed_at: String,
    pub url: String,
    pub author_name: Option<String>,
    pub author_login: Option<String>,
    pub author_avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrDetailFile {
    pub path: String,
    pub change_type: String,
    pub additions: i64,
    pub deletions: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrDetailCheck {
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub details_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrDetailTruncation {
    pub comments: bool,
    pub reviews: bool,
    pub commits: bool,
    pub files: bool,
    pub checks: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrDetail {
    pub repo: String,
    pub number: i64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub draft: bool,
    pub mergeable: Option<String>,
    pub review_decision: Option<String>,
    pub body: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub author_login: Option<String>,
    pub author_avatar: Option<String>,
    pub head_branch: Option<String>,
    pub base_branch: Option<String>,
    pub additions: i64,
    pub deletions: i64,
    pub changed_files: i64,
    pub comment_count: i64,
    pub commit_count: i64,
    pub linear_identifier: Option<String>,
    pub comments: Vec<PrDetailComment>,
    pub reviews: Vec<PrDetailReview>,
    pub commits: Vec<PrDetailCommit>,
    pub files: Vec<PrDetailFile>,
    pub checks: Vec<PrDetailCheck>,
    pub truncated: PrDetailTruncation,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrDiffFile {
    pub path: String,
    pub previous_path: Option<String>,
    pub change_type: String,
    pub additions: i64,
    pub deletions: i64,
    pub changes: i64,
    pub patch: Option<String>,
    pub blob_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrDiff {
    pub repo: String,
    pub number: i64,
    pub files: Vec<PrDiffFile>,
    pub total_files: usize,
    pub truncated: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_name_rejects_dot_only_segments() {
        for invalid in ["../repo", "owner/..", "./x", "owner/."] {
            assert!(parse_repo_name(invalid).is_none(), "{invalid:?}");
        }
        assert_eq!(
            parse_repo_name("ws/.github").unwrap().scope,
            "repo:ws/.github"
        );
    }
}
