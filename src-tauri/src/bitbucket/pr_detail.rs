//! Live PR detail: the PR object plus one bounded page each of comments,
//! commits, diffstat, and build statuses, assembled into the shared `PrDetail`.

use serde_json::Value;

use super::prs::{parse_pr, parse_reviewers, review_decision};
use super::{account_avatar, account_login, next_link, page_values, str_at, BitbucketError};
use crate::code_host::{
    PrDetail, PrDetailCheck, PrDetailComment, PrDetailCommit, PrDetailFile, PrDetailReview,
    PrDetailTruncation, RepositoryName,
};

#[derive(Debug, Clone, PartialEq)]
pub struct DetailPaths {
    pub pr: String,
    pub comments: String,
    pub commits: String,
    pub diffstat: String,
    pub statuses: String,
}

pub fn detail_paths(repo: &RepositoryName, id: i64) -> Result<DetailPaths, BitbucketError> {
    if id <= 0 || id > i32::MAX as i64 {
        return Err(BitbucketError::Malformed);
    }
    let base = format!(
        "/repositories/{}/{}/pullrequests/{id}",
        repo.owner, repo.name
    );
    Ok(DetailPaths {
        pr: base.clone(),
        // Newest first, so a truncated page keeps the latest discussion.
        comments: format!("{base}/comments?pagelen=100&sort=-created_on"),
        commits: format!("{base}/commits?pagelen=50"),
        diffstat: format!("{base}/diffstat?pagelen=100"),
        statuses: format!("{base}/statuses?pagelen=100"),
    })
}

/// The five raw responses a detail view is built from.
pub struct DetailPages {
    pub pr: Value,
    pub comments: Value,
    pub commits: Value,
    pub diffstat: Value,
    pub statuses: Value,
}

fn has_more(page: &Value) -> Result<bool, BitbucketError> {
    Ok(next_link(page)?.is_some())
}

fn html_href(v: &Value) -> Option<String> {
    v.get("links")
        .and_then(|l| l.get("html"))
        .and_then(|h| str_at(h, "href"))
}

fn id_string(v: &Value) -> Option<String> {
    match v.get("id") {
        Some(Value::Number(n)) => Some(n.to_string()),
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

fn parse_comments(page: &Value, pr_url: &str) -> Result<Vec<PrDetailComment>, BitbucketError> {
    let mut out = Vec::new();
    for c in page_values(page)? {
        if c.get("deleted").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let user = c.get("user");
        out.push(PrDetailComment {
            id: id_string(c).ok_or(BitbucketError::Malformed)?,
            body: c
                .get("content")
                .and_then(|x| str_at(x, "raw"))
                .unwrap_or_default(),
            created_at: str_at(c, "created_on").ok_or(BitbucketError::Malformed)?,
            url: html_href(c).unwrap_or_else(|| pr_url.to_string()),
            author_login: account_login(user),
            author_avatar: account_avatar(user),
        });
    }
    Ok(out)
}

/// `"Jane Doe <jane@example.com>"` → `"Jane Doe"`.
fn raw_author_name(raw: &str) -> Option<String> {
    let name = raw.split('<').next().unwrap_or("").trim();
    (!name.is_empty()).then(|| name.to_string())
}

fn parse_commits(page: &Value) -> Result<Vec<PrDetailCommit>, BitbucketError> {
    page_values(page)?
        .iter()
        .map(|c| {
            let author = c.get("author");
            let user = author.and_then(|a| a.get("user"));
            let hash = str_at(c, "hash").ok_or(BitbucketError::Malformed)?;
            Ok(PrDetailCommit {
                headline: str_at(c, "message")
                    .unwrap_or_default()
                    .lines()
                    .next()
                    .unwrap_or("")
                    .to_string(),
                committed_at: str_at(c, "date").ok_or(BitbucketError::Malformed)?,
                url: html_href(c).unwrap_or_default(),
                author_name: author
                    .and_then(|a| str_at(a, "raw"))
                    .and_then(|raw| raw_author_name(&raw)),
                author_login: account_login(user),
                author_avatar: account_avatar(user),
                oid: hash,
            })
        })
        .collect()
}

fn parse_diffstat(page: &Value) -> Result<Vec<PrDetailFile>, BitbucketError> {
    page_values(page)?
        .iter()
        .map(|f| {
            let path = f
                .get("new")
                .and_then(|n| str_at(n, "path"))
                .or_else(|| f.get("old").and_then(|o| str_at(o, "path")))
                .ok_or(BitbucketError::Malformed)?;
            Ok(PrDetailFile {
                path,
                change_type: str_at(f, "status")
                    .ok_or(BitbucketError::Malformed)?
                    .to_ascii_lowercase(),
                additions: f.get("lines_added").and_then(Value::as_i64).unwrap_or(0),
                deletions: f.get("lines_removed").and_then(Value::as_i64).unwrap_or(0),
            })
        })
        .collect()
}

/// Bitbucket build state → GitHub-shaped (status, conclusion) the UI reads.
fn check_state(state: &str) -> (String, Option<String>) {
    match state {
        "SUCCESSFUL" => ("completed".into(), Some("success".into())),
        "FAILED" => ("completed".into(), Some("failure".into())),
        "STOPPED" => ("completed".into(), Some("cancelled".into())),
        "INPROGRESS" => ("in_progress".into(), None),
        other => (other.to_ascii_lowercase(), None),
    }
}

fn parse_statuses(page: &Value) -> Result<Vec<PrDetailCheck>, BitbucketError> {
    page_values(page)?
        .iter()
        .map(|s| {
            let (status, conclusion) =
                check_state(&str_at(s, "state").ok_or(BitbucketError::Malformed)?);
            Ok(PrDetailCheck {
                name: str_at(s, "name")
                    .or_else(|| str_at(s, "key"))
                    .ok_or(BitbucketError::Malformed)?,
                status,
                conclusion,
                details_url: str_at(s, "url"),
            })
        })
        .collect()
}

/// Approvals and change requests surface as reviews (Bitbucket has no review
/// bodies; the comments carry the discussion).
fn parse_reviews(pr: &Value, pr_url: &str, fallback_at: &str) -> Vec<PrDetailReview> {
    pr.get("participants")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let state = if p.get("state").and_then(Value::as_str) == Some("changes_requested") {
                "changes_requested"
            } else if p.get("approved").and_then(Value::as_bool) == Some(true) {
                "approved"
            } else {
                return None;
            };
            let user = p.get("user");
            let login = account_login(user);
            Some(PrDetailReview {
                id: format!(
                    "participant:{}",
                    user.and_then(|u| str_at(u, "uuid"))
                        .or_else(|| login.clone())
                        .unwrap_or_default()
                ),
                body: String::new(),
                state: state.into(),
                submitted_at: str_at(p, "participated_on")
                    .unwrap_or_else(|| fallback_at.to_string()),
                url: pr_url.to_string(),
                author_login: login,
                author_avatar: account_avatar(user),
            })
        })
        .collect()
}

fn map_state(state: &str) -> &'static str {
    match state {
        "MERGED" => "MERGED",
        "DECLINED" | "SUPERSEDED" => "CLOSED",
        _ => "OPEN",
    }
}

pub fn parse_pr_detail(pages: &DetailPages) -> Result<PrDetail, BitbucketError> {
    let pr = &pages.pr;
    let row = parse_pr(pr)?;
    let url = row.url.clone().ok_or(BitbucketError::Malformed)?;
    let created_at = str_at(pr, "created_on").ok_or(BitbucketError::Malformed)?;
    let updated_at = str_at(pr, "updated_on").ok_or(BitbucketError::Malformed)?;
    let comments = parse_comments(&pages.comments, &url)?;
    let commits = parse_commits(&pages.commits)?;
    let files = parse_diffstat(&pages.diffstat)?;
    let checks = parse_statuses(&pages.statuses)?;
    let reviews = parse_reviews(pr, &url, &updated_at);
    let body = pr
        .get("summary")
        .and_then(|s| str_at(s, "raw"))
        .or_else(|| str_at(pr, "description"))
        .filter(|b| !b.is_empty());
    Ok(PrDetail {
        repo: row.repo,
        number: row.number,
        title: row.title.unwrap_or_default(),
        url,
        state: map_state(&str_at(pr, "state").unwrap_or_default()).into(),
        draft: row.draft,
        mergeable: Some("unknown".into()),
        review_decision: review_decision(&parse_reviewers(pr)),
        body,
        created_at,
        updated_at,
        author_login: row.author_login,
        author_avatar: row.author_avatar,
        head_branch: row.branch,
        base_branch: row.base_branch,
        additions: files.iter().map(|f| f.additions).sum(),
        deletions: files.iter().map(|f| f.deletions).sum(),
        changed_files: files.len() as i64,
        comment_count: row.comment_count.unwrap_or(comments.len() as i64),
        commit_count: commits.len() as i64,
        linear_identifier: row.linear_identifier,
        truncated: PrDetailTruncation {
            comments: has_more(&pages.comments)?,
            reviews: false,
            commits: has_more(&pages.commits)?,
            files: has_more(&pages.diffstat)?,
            checks: has_more(&pages.statuses)?,
        },
        comments,
        reviews,
        commits,
        files,
        checks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bitbucket::prs::tests::{account, pr_json};
    use crate::code_host::parse_repo_name;
    use serde_json::json;

    fn pages() -> DetailPages {
        let mut pr = pr_json(
            7,
            "acme/api",
            json!([
                { "user": account("{a}", "alice"), "role": "REVIEWER", "approved": true,
                  "state": "approved", "participated_on": "2026-10-27T08:00:00+00:00" },
                { "user": account("{b}", "bob"), "role": "REVIEWER", "approved": false,
                  "state": null }
            ]),
        );
        pr["summary"] = json!({ "raw": "Adds the **widget**.", "markup": "markdown" });
        DetailPages {
            pr,
            comments: json!({
                "values": [
                    { "id": 11, "content": { "raw": "Looks good" }, "user": account("{a}", "alice"),
                      "created_on": "2026-10-26T10:00:00+00:00", "deleted": false,
                      "links": { "html": { "href": "https://bitbucket.org/acme/api/pull-requests/7#comment-11" } } },
                    { "id": 12, "content": { "raw": "" }, "user": account("{b}", "bob"),
                      "created_on": "2026-10-26T11:00:00+00:00", "deleted": true }
                ],
                "next": "https://api.bitbucket.org/2.0/repositories/acme/api/pullrequests/7/comments?page=2"
            }),
            commits: json!({ "values": [
                { "hash": "abc123", "message": "Add widget\n\nLonger body", "date": "2026-10-25T10:00:00+00:00",
                  "author": { "raw": "Jane Doe <jane@example.com>", "user": account("{j}", "jane") },
                  "links": { "html": { "href": "https://bitbucket.org/acme/api/commits/abc123" } } }
            ] }),
            diffstat: json!({ "values": [
                { "status": "modified", "lines_added": 10, "lines_removed": 2,
                  "old": { "path": "src/a.rs" }, "new": { "path": "src/a.rs" } },
                { "status": "removed", "lines_added": 0, "lines_removed": 5,
                  "old": { "path": "src/old.rs" }, "new": null }
            ] }),
            statuses: json!({ "values": [
                { "key": "build", "name": "Pipeline #42", "state": "FAILED", "url": "https://ci/42" },
                { "key": "lint", "state": "INPROGRESS" }
            ] }),
        }
    }

    #[test]
    fn detail_paths_are_bounded_and_validated() {
        let repo = parse_repo_name("acme/api").unwrap();
        let p = detail_paths(&repo, 7).unwrap();
        assert_eq!(p.pr, "/repositories/acme/api/pullrequests/7");
        assert_eq!(
            p.comments,
            "/repositories/acme/api/pullrequests/7/comments?pagelen=100&sort=-created_on"
        );
        assert!(p.diffstat.ends_with("/diffstat?pagelen=100"));
        assert!(detail_paths(&repo, 0).is_err());
    }

    #[test]
    fn assembles_detail_from_pages() {
        let d = parse_pr_detail(&pages()).unwrap();
        assert_eq!(d.repo, "acme/api");
        assert_eq!(d.number, 7);
        assert_eq!(d.state, "OPEN");
        assert_eq!(d.body.as_deref(), Some("Adds the **widget**."));
        assert_eq!(d.head_branch.as_deref(), Some("feature/eng-12-widget"));
        assert_eq!(d.review_decision.as_deref(), Some("approved"));
        // Deleted comments are dropped; more pages → truncated.
        assert_eq!(d.comments.len(), 1);
        assert_eq!(d.comments[0].id, "11");
        assert!(d.truncated.comments);
        assert_eq!(d.reviews.len(), 1);
        assert_eq!(d.reviews[0].state, "approved");
        assert_eq!(d.reviews[0].author_login.as_deref(), Some("alice"));
        assert_eq!(d.commits[0].headline, "Add widget");
        assert_eq!(d.commits[0].author_name.as_deref(), Some("Jane Doe"));
        assert_eq!(d.commits[0].author_login.as_deref(), Some("jane"));
        assert_eq!(d.files.len(), 2);
        assert_eq!(d.files[1].path, "src/old.rs");
        assert_eq!(d.files[1].change_type, "removed");
        assert_eq!((d.additions, d.deletions, d.changed_files), (10, 7, 2));
        assert_eq!(d.checks[0].name, "Pipeline #42");
        assert_eq!(d.checks[0].conclusion.as_deref(), Some("failure"));
        assert_eq!(d.checks[1].name, "lint");
        assert_eq!(d.checks[1].status, "in_progress");
        assert!(!d.truncated.files);
    }

    #[test]
    fn declined_maps_to_closed_and_bad_pages_fail() {
        let mut p = pages();
        p.pr["state"] = json!("DECLINED");
        assert_eq!(parse_pr_detail(&p).unwrap().state, "CLOSED");
        let mut broken = pages();
        broken.statuses = json!({ "error": { "message": "nope" } });
        assert!(parse_pr_detail(&broken).is_err());
    }
}
