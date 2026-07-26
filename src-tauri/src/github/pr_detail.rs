use serde::Serialize;
use serde_json::{json, Value};

use super::prs::extract_linear_identifier;
use super::repositories::RepositoryName;
use super::GitHubError;

const PR_DETAIL_QUERY: &str = r#"query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      number title url state isDraft mergeable reviewDecision body createdAt updatedAt
      additions deletions changedFiles headRefName baseRefName
      repository{ nameWithOwner }
      author{ login avatarUrl }
      comments(first:100){
        totalCount
        nodes{ id body createdAt url author{ login avatarUrl } }
      }
      reviews(first:100){
        totalCount
        nodes{ id body state submittedAt url author{ login avatarUrl } }
      }
      commits(last:50){
        totalCount
        nodes{
          commit{
            oid messageHeadline committedDate url
            author{ name user{ login avatarUrl } }
          }
        }
      }
      files(first:100){
        totalCount
        nodes{ path changeType additions deletions }
      }
      statusCheckRollup{
        contexts(first:100){
          totalCount
          nodes{
            __typename
            ... on CheckRun{ name status conclusion detailsUrl }
            ... on StatusContext{ context state targetUrl }
          }
        }
      }
    }
  }
}"#;

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

pub fn build_pr_detail_body(repo: &RepositoryName, number: i64) -> Result<Value, GitHubError> {
    if number <= 0 || number > i32::MAX as i64 {
        return Err(GitHubError::Malformed);
    }
    Ok(json!({
        "query": PR_DETAIL_QUERY,
        "variables": {
            "owner": repo.owner,
            "name": repo.name,
            "number": number,
        }
    }))
}

fn required_str(value: &Value, key: &str) -> Result<String, GitHubError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or(GitHubError::Malformed)
}

fn optional_str(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn required_i64(value: &Value, key: &str) -> Result<i64, GitHubError> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .ok_or(GitHubError::Malformed)
}

fn actor(value: Option<&Value>) -> (Option<String>, Option<String>) {
    let Some(value) = value else {
        return (None, None);
    };
    (
        optional_str(value, "login"),
        optional_str(value, "avatarUrl"),
    )
}

fn connection(value: &Value) -> Result<(&Vec<Value>, i64), GitHubError> {
    let nodes = value
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or(GitHubError::Malformed)?;
    let total = required_i64(value, "totalCount")?;
    Ok((nodes, total))
}

fn lower(value: &str) -> String {
    value.to_ascii_lowercase()
}

fn mergeable(value: Option<&str>) -> Option<String> {
    value.map(|value| match value {
        "MERGEABLE" => "mergeable".to_string(),
        "CONFLICTING" => "conflicting".to_string(),
        _ => "unknown".to_string(),
    })
}

fn review_decision(value: Option<&str>) -> Option<String> {
    match value {
        Some("APPROVED") => Some("approved".to_string()),
        Some("CHANGES_REQUESTED") => Some("changes_requested".to_string()),
        Some("REVIEW_REQUIRED") => Some("review_required".to_string()),
        _ => None,
    }
}

fn parse_comments(value: &Value) -> Result<(Vec<PrDetailComment>, bool, i64), GitHubError> {
    let (nodes, total) = connection(value)?;
    let comments = nodes
        .iter()
        .map(|node| {
            let (author_login, author_avatar) = actor(node.get("author"));
            Ok(PrDetailComment {
                id: required_str(node, "id")?,
                body: required_str(node, "body")?,
                created_at: required_str(node, "createdAt")?,
                url: required_str(node, "url")?,
                author_login,
                author_avatar,
            })
        })
        .collect::<Result<Vec<_>, GitHubError>>()?;
    Ok((comments, total > nodes.len() as i64, total))
}

fn parse_reviews(value: &Value) -> Result<(Vec<PrDetailReview>, bool), GitHubError> {
    let (nodes, total) = connection(value)?;
    let reviews = nodes
        .iter()
        .map(|node| {
            let (author_login, author_avatar) = actor(node.get("author"));
            Ok(PrDetailReview {
                id: required_str(node, "id")?,
                body: required_str(node, "body")?,
                state: lower(&required_str(node, "state")?),
                submitted_at: required_str(node, "submittedAt")?,
                url: required_str(node, "url")?,
                author_login,
                author_avatar,
            })
        })
        .collect::<Result<Vec<_>, GitHubError>>()?;
    Ok((reviews, total > nodes.len() as i64))
}

fn parse_commits(value: &Value) -> Result<(Vec<PrDetailCommit>, bool, i64), GitHubError> {
    let (nodes, total) = connection(value)?;
    let commits = nodes
        .iter()
        .map(|node| {
            let commit = node.get("commit").ok_or(GitHubError::Malformed)?;
            let author = commit.get("author");
            let (author_login, author_avatar) = actor(author.and_then(|a| a.get("user")));
            Ok(PrDetailCommit {
                oid: required_str(commit, "oid")?,
                headline: required_str(commit, "messageHeadline")?,
                committed_at: required_str(commit, "committedDate")?,
                url: required_str(commit, "url")?,
                author_name: author.and_then(|a| optional_str(a, "name")),
                author_login,
                author_avatar,
            })
        })
        .collect::<Result<Vec<_>, GitHubError>>()?;
    Ok((commits, total > nodes.len() as i64, total))
}

fn parse_files(value: &Value) -> Result<(Vec<PrDetailFile>, bool), GitHubError> {
    let (nodes, total) = connection(value)?;
    let files = nodes
        .iter()
        .map(|node| {
            Ok(PrDetailFile {
                path: required_str(node, "path")?,
                change_type: lower(&required_str(node, "changeType")?),
                additions: required_i64(node, "additions")?,
                deletions: required_i64(node, "deletions")?,
            })
        })
        .collect::<Result<Vec<_>, GitHubError>>()?;
    Ok((files, total > nodes.len() as i64))
}

fn status_context(value: &str) -> (String, Option<String>) {
    match value {
        "SUCCESS" => ("completed".to_string(), Some("success".to_string())),
        "FAILURE" | "ERROR" => ("completed".to_string(), Some("failure".to_string())),
        "PENDING" => ("in_progress".to_string(), None),
        "EXPECTED" => ("queued".to_string(), None),
        other => (lower(other), None),
    }
}

fn parse_checks(value: Option<&Value>) -> Result<(Vec<PrDetailCheck>, bool), GitHubError> {
    let Some(rollup) = value.filter(|value| !value.is_null()) else {
        return Ok((Vec::new(), false));
    };
    let contexts = rollup.get("contexts").ok_or(GitHubError::Malformed)?;
    let (nodes, total) = connection(contexts)?;
    let checks = nodes
        .iter()
        .map(
            |node| match node.get("__typename").and_then(Value::as_str) {
                Some("CheckRun") => Ok(PrDetailCheck {
                    name: required_str(node, "name")?,
                    status: lower(&required_str(node, "status")?),
                    conclusion: optional_str(node, "conclusion").map(|value| lower(&value)),
                    details_url: optional_str(node, "detailsUrl"),
                }),
                Some("StatusContext") => {
                    let (status, conclusion) = status_context(&required_str(node, "state")?);
                    Ok(PrDetailCheck {
                        name: required_str(node, "context")?,
                        status,
                        conclusion,
                        details_url: optional_str(node, "targetUrl"),
                    })
                }
                _ => Err(GitHubError::Malformed),
            },
        )
        .collect::<Result<Vec<_>, GitHubError>>()?;
    Ok((checks, total > nodes.len() as i64))
}

pub fn parse_pr_detail(data: &Value) -> Result<PrDetail, GitHubError> {
    let pr = data
        .get("repository")
        .and_then(|repository| repository.get("pullRequest"))
        .filter(|value| !value.is_null())
        .ok_or(GitHubError::Malformed)?;
    let repo = pr
        .get("repository")
        .and_then(|repository| required_str(repository, "nameWithOwner").ok())
        .ok_or(GitHubError::Malformed)?;
    let title = required_str(pr, "title")?;
    let head_branch = optional_str(pr, "headRefName");
    let base_branch = optional_str(pr, "baseRefName");
    let (author_login, author_avatar) = actor(pr.get("author"));
    let (comments, comments_truncated, comment_count) =
        parse_comments(pr.get("comments").ok_or(GitHubError::Malformed)?)?;
    let (reviews, reviews_truncated) =
        parse_reviews(pr.get("reviews").ok_or(GitHubError::Malformed)?)?;
    let (commits, commits_truncated, commit_count) =
        parse_commits(pr.get("commits").ok_or(GitHubError::Malformed)?)?;
    let (files, files_truncated) = parse_files(pr.get("files").ok_or(GitHubError::Malformed)?)?;
    let (checks, checks_truncated) = parse_checks(pr.get("statusCheckRollup"))?;
    let linear_identifier = extract_linear_identifier(head_branch.as_deref().unwrap_or(""), &title);

    Ok(PrDetail {
        repo,
        number: required_i64(pr, "number")?,
        title,
        url: required_str(pr, "url")?,
        state: lower(&required_str(pr, "state")?),
        draft: pr
            .get("isDraft")
            .and_then(Value::as_bool)
            .ok_or(GitHubError::Malformed)?,
        mergeable: mergeable(pr.get("mergeable").and_then(Value::as_str)),
        review_decision: review_decision(pr.get("reviewDecision").and_then(Value::as_str)),
        body: optional_str(pr, "body"),
        created_at: required_str(pr, "createdAt")?,
        updated_at: required_str(pr, "updatedAt")?,
        author_login,
        author_avatar,
        head_branch,
        base_branch,
        additions: required_i64(pr, "additions")?,
        deletions: required_i64(pr, "deletions")?,
        changed_files: required_i64(pr, "changedFiles")?,
        comment_count,
        commit_count,
        linear_identifier,
        comments,
        reviews,
        commits,
        files,
        checks,
        truncated: PrDetailTruncation {
            comments: comments_truncated,
            reviews: reviews_truncated,
            commits: commits_truncated,
            files: files_truncated,
            checks: checks_truncated,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::repositories::parse_repository;
    use serde_json::json;

    fn sample_detail_data() -> serde_json::Value {
        json!({
            "repository": {
                "pullRequest": {
                    "number": 42,
                    "title": "Add widget",
                    "url": "https://github.com/o/r/pull/42",
                    "state": "OPEN",
                    "isDraft": false,
                    "mergeable": "MERGEABLE",
                    "reviewDecision": "REVIEW_REQUIRED",
                    "body": "## Summary",
                    "createdAt": "2026-07-20T10:00:00Z",
                    "updatedAt": "2026-07-26T10:00:00Z",
                    "additions": 120,
                    "deletions": 8,
                    "changedFiles": 101,
                    "headRefName": "eng-9-widget",
                    "baseRefName": "main",
                    "repository": { "nameWithOwner": "o/r" },
                    "author": { "login": "octocat", "avatarUrl": "https://a/octocat.png" },
                    "comments": {
                        "totalCount": 1,
                        "nodes": [{
                            "id": "c1",
                            "body": "Looks good",
                            "createdAt": "2026-07-25T12:00:00Z",
                            "url": "https://github.com/o/r/pull/42#issuecomment-1",
                            "author": { "login": "reviewer", "avatarUrl": null }
                        }]
                    },
                    "reviews": {
                        "totalCount": 1,
                        "nodes": [{
                            "id": "r1",
                            "body": "Approved",
                            "state": "APPROVED",
                            "submittedAt": "2026-07-24T12:00:00Z",
                            "url": "https://github.com/o/r/pull/42#pullrequestreview-1",
                            "author": { "login": "reviewer", "avatarUrl": null }
                        }]
                    },
                    "commits": {
                        "totalCount": 51,
                        "nodes": [{
                            "commit": {
                                "oid": "abc123",
                                "messageHeadline": "Add widget",
                                "committedDate": "2026-07-23T12:00:00Z",
                                "url": "https://github.com/o/r/commit/abc123",
                                "author": {
                                    "name": "Octo Cat",
                                    "user": { "login": "octocat", "avatarUrl": "https://a/octocat.png" }
                                }
                            }
                        }]
                    },
                    "files": {
                        "totalCount": 101,
                        "nodes": [{
                            "path": "src/a.ts",
                            "changeType": "MODIFIED",
                            "additions": 12,
                            "deletions": 2
                        }]
                    },
                    "statusCheckRollup": {
                        "contexts": {
                            "totalCount": 2,
                            "nodes": [
                                {
                                    "__typename": "CheckRun",
                                    "name": "test",
                                    "status": "COMPLETED",
                                    "conclusion": "SUCCESS",
                                    "detailsUrl": "https://github.com/o/r/actions/runs/1"
                                },
                                {
                                    "__typename": "StatusContext",
                                    "context": "lint",
                                    "state": "FAILURE",
                                    "targetUrl": "https://ci.example/lint"
                                }
                            ]
                        }
                    }
                }
            }
        })
    }

    #[test]
    fn detail_query_uses_variables_and_bounded_connections() {
        let repo = parse_repository("o/r").unwrap();
        let body = build_pr_detail_body(&repo, 42).unwrap();
        assert_eq!(body["variables"]["owner"], "o");
        assert_eq!(body["variables"]["name"], "r");
        assert_eq!(body["variables"]["number"], 42);
        let query = body["query"].as_str().unwrap();
        for bound in [
            "comments(first:100)",
            "reviews(first:100)",
            "files(first:100)",
        ] {
            assert!(query.contains(bound), "{bound}");
        }
        assert!(query.contains("commits(last:50)"));
        assert!(query.contains("contexts(first:100)"));
    }

    #[test]
    fn parses_full_pr_detail_and_truncation() {
        let detail = parse_pr_detail(&sample_detail_data()).unwrap();
        assert_eq!(detail.repo, "o/r");
        assert_eq!(detail.number, 42);
        assert_eq!(detail.title, "Add widget");
        assert_eq!(detail.body.as_deref(), Some("## Summary"));
        assert_eq!(detail.linear_identifier.as_deref(), Some("ENG-9"));
        assert_eq!(detail.comments[0].body, "Looks good");
        assert_eq!(detail.reviews[0].state, "approved");
        assert_eq!(detail.commits[0].oid, "abc123");
        assert_eq!(detail.commit_count, 51);
        assert_eq!(detail.files[0].path, "src/a.ts");
        assert_eq!(detail.checks[0].name, "test");
        assert_eq!(detail.checks[0].conclusion.as_deref(), Some("success"));
        assert_eq!(detail.checks[1].name, "lint");
        assert_eq!(detail.checks[1].conclusion.as_deref(), Some("failure"));
        assert!(!detail.truncated.comments);
        assert!(detail.truncated.commits);
        assert!(detail.truncated.files);
        assert!(!detail.truncated.checks);
    }

    #[test]
    fn missing_pr_and_malformed_required_fields_are_rejected() {
        assert!(parse_pr_detail(&json!({ "repository": { "pullRequest": null } })).is_err());
        let mut data = sample_detail_data();
        data["repository"]["pullRequest"]["title"] = serde_json::Value::Null;
        assert!(parse_pr_detail(&data).is_err());
    }

    #[test]
    fn nullable_authors_and_check_rollup_are_supported() {
        let mut data = sample_detail_data();
        data["repository"]["pullRequest"]["author"] = serde_json::Value::Null;
        data["repository"]["pullRequest"]["comments"]["nodes"][0]["author"] =
            serde_json::Value::Null;
        data["repository"]["pullRequest"]["statusCheckRollup"] = serde_json::Value::Null;
        let detail = parse_pr_detail(&data).unwrap();
        assert_eq!(detail.author_login, None);
        assert_eq!(detail.comments[0].author_login, None);
        assert!(detail.checks.is_empty());
    }

    #[test]
    fn invalid_pr_number_is_rejected_before_building_a_request() {
        let repo = parse_repository("o/r").unwrap();
        assert!(build_pr_detail_body(&repo, 0).is_err());
    }
}
