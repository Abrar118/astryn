use super::GitHubError;
use regex::Regex;
use serde_json::{json, Value};
use std::sync::OnceLock;

pub const PER_BUCKET_CAP: usize = 300;
pub const PAGE_SIZE: i64 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bucket {
    NeedsReview,
    Mine,
    Assigned,
    Involved,
}

impl Bucket {
    pub fn all() -> [Bucket; 4] {
        [
            Bucket::NeedsReview,
            Bucket::Mine,
            Bucket::Assigned,
            Bucket::Involved,
        ]
    }

    pub fn key(&self) -> &'static str {
        match self {
            Bucket::NeedsReview => "needs_review",
            Bucket::Mine => "mine",
            Bucket::Assigned => "assigned",
            Bucket::Involved => "involved",
        }
    }

    pub fn search_query(&self) -> String {
        let base = match self {
            Bucket::NeedsReview => "is:pr is:open review-requested:@me",
            Bucket::Mine => "is:pr is:open author:@me",
            Bucket::Assigned => "is:pr is:open assignee:@me",
            Bucket::Involved => {
                "is:pr is:open involves:@me -author:@me -assignee:@me -review-requested:@me"
            }
        };
        format!("{base} sort:updated-desc")
    }
}

const SEARCH_QUERY: &str = r#"query($q:String!,$first:Int!,$after:String){
  search(query:$q,type:ISSUE,first:$first,after:$after){
    pageInfo{ hasNextPage endCursor }
    nodes{
      ... on PullRequest {
        number title url isDraft mergeable reviewDecision updatedAt
        repository{ nameWithOwner }
        headRefName
        baseRefName
        author{ login avatarUrl }
        comments{ totalCount }
        statusCheckRollup{ state }
      }
    }
  }
}"#;

pub fn build_search_body(query: &str, first: i64, after: Option<&str>) -> Value {
    json!({
        "query": SEARCH_QUERY,
        "variables": { "q": query, "first": first, "after": after }
    })
}

fn identifier_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\b[A-Z][A-Z0-9]*-\d+\b").unwrap())
}

/// Extract a Linear issue identifier (e.g. "ENG-123") from a branch name or PR
/// title, normalized to uppercase. Branch wins over title.
pub fn extract_linear_identifier(branch: &str, title: &str) -> Option<String> {
    for s in [branch, title] {
        if let Some(m) = identifier_regex().find(s) {
            return Some(m.as_str().to_uppercase());
        }
    }
    None
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
}

#[derive(Debug, Clone)]
pub struct PageInfo {
    pub has_next_page: bool,
    pub end_cursor: Option<String>,
}

fn str_at(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(Into::into)
}

fn map_mergeable(v: Option<&str>) -> Option<String> {
    Some(
        match v {
            Some("MERGEABLE") => "mergeable",
            Some("CONFLICTING") => "conflicting",
            _ => "unknown",
        }
        .to_string(),
    )
}

fn map_review(v: Option<&str>) -> Option<String> {
    match v {
        Some("APPROVED") => Some("approved".into()),
        Some("CHANGES_REQUESTED") => Some("changes_requested".into()),
        Some("REVIEW_REQUIRED") => Some("review_required".into()),
        _ => None, // null preserved; unknown values are not invented
    }
}

fn map_ci(v: Option<&str>) -> Option<String> {
    Some(
        match v {
            Some("SUCCESS") => "success",
            Some("FAILURE") | Some("ERROR") => "failure",
            Some("PENDING") | Some("EXPECTED") => "pending",
            _ => "none",
        }
        .to_string(),
    )
}

fn node_to_pr(n: &Value) -> Result<ParsedPr, GitHubError> {
    // With `is:pr`, every search node IS a PullRequest; a node missing required
    // fields is malformed and must fail the page (never silently disappear).
    let number = n
        .get("number")
        .and_then(Value::as_i64)
        .ok_or(GitHubError::Malformed)?;
    let repo = n
        .get("repository")
        .and_then(|r| str_at(r, "nameWithOwner"))
        .ok_or(GitHubError::Malformed)?;
    let branch = str_at(n, "headRefName");
    let base_branch = str_at(n, "baseRefName");
    let title = str_at(n, "title");
    let linear_identifier = extract_linear_identifier(
        branch.as_deref().unwrap_or(""),
        title.as_deref().unwrap_or(""),
    );
    let ci = n
        .get("statusCheckRollup")
        .and_then(|r| r.get("state"))
        .and_then(|s| s.as_str());
    Ok(ParsedPr {
        id: format!("{repo}#{number}"),
        repo,
        number,
        title,
        draft: n.get("isDraft").and_then(Value::as_bool).unwrap_or(false),
        mergeable: map_mergeable(n.get("mergeable").and_then(|m| m.as_str())),
        ci_status: map_ci(ci),
        review_decision: map_review(n.get("reviewDecision").and_then(|r| r.as_str())),
        author_login: n.get("author").and_then(|a| str_at(a, "login")),
        author_avatar: n.get("author").and_then(|a| str_at(a, "avatarUrl")),
        comment_count: n
            .get("comments")
            .and_then(|c| c.get("totalCount"))
            .and_then(Value::as_i64),
        branch,
        base_branch,
        url: str_at(n, "url"),
        linear_identifier,
        updated_at: str_at(n, "updatedAt"),
    })
}

/// Parse one `search` page into PRs + pagination info. Missing `search`/`nodes`/
/// `pageInfo.hasNextPage` is `Malformed` — never an empty success, which would
/// let sync transactionally erase a bucket.
pub fn parse_search_page(data: &Value) -> Result<(Vec<ParsedPr>, PageInfo), GitHubError> {
    let search = data.get("search").ok_or(GitHubError::Malformed)?;
    let nodes = search
        .get("nodes")
        .and_then(|n| n.as_array())
        .ok_or(GitHubError::Malformed)?;
    let prs = nodes
        .iter()
        .map(node_to_pr)
        .collect::<Result<Vec<_>, _>>()?;
    let page = search.get("pageInfo").ok_or(GitHubError::Malformed)?;
    let page_info = PageInfo {
        has_next_page: page
            .get("hasNextPage")
            .and_then(Value::as_bool)
            .ok_or(GitHubError::Malformed)?,
        end_cursor: str_at(page, "endCursor"),
    };
    Ok((prs, page_info))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bucket_keys_are_stable() {
        let keys: Vec<_> = Bucket::all().iter().map(|b| b.key()).collect();
        assert_eq!(keys, ["needs_review", "mine", "assigned", "involved"]);
    }

    #[test]
    fn queries_carry_sort_and_open_pr_filters() {
        for b in Bucket::all() {
            let q = b.search_query();
            assert!(q.contains("is:pr"), "{q}");
            assert!(q.contains("is:open"), "{q}");
            assert!(q.contains("sort:updated-desc"), "{q}");
        }
    }

    #[test]
    fn involved_excludes_other_buckets() {
        let q = Bucket::Involved.search_query();
        assert!(q.contains("involves:@me"));
        assert!(q.contains("-author:@me"));
        assert!(q.contains("-assignee:@me"));
        assert!(q.contains("-review-requested:@me"));
    }

    #[test]
    fn search_body_sets_variables_and_null_cursor() {
        let body = build_search_body("is:pr is:open author:@me", 100, None);
        assert_eq!(body["variables"]["q"], "is:pr is:open author:@me");
        assert_eq!(body["variables"]["first"], 100);
        assert!(body["variables"]["after"].is_null());
        assert!(body["query"].as_str().unwrap().contains("search("));
    }

    #[test]
    fn extracts_uppercase_from_branch() {
        assert_eq!(
            extract_linear_identifier("feature/ENG-123-fix", ""),
            Some("ENG-123".to_string())
        );
    }

    #[test]
    fn normalizes_lowercase_branch() {
        assert_eq!(
            extract_linear_identifier("eng-123-fix", ""),
            Some("ENG-123".to_string())
        );
    }

    #[test]
    fn falls_back_to_title() {
        assert_eq!(
            extract_linear_identifier("main", "Fix ENG-7: crash"),
            Some("ENG-7".to_string())
        );
    }

    #[test]
    fn rejects_embedded_substring() {
        // No word boundary around the candidate -> not a real identifier.
        assert_eq!(extract_linear_identifier("xENG-123y", ""), None);
    }

    #[test]
    fn release_like_extracts_but_is_filtered_at_join() {
        // `release-2024` validly matches the pattern; it only becomes a chip if it
        // joins a real cached issue (verified in the DB-join task), so extraction
        // must surface it here.
        assert_eq!(
            extract_linear_identifier("release-2024", ""),
            Some("RELEASE-2024".to_string())
        );
    }

    #[test]
    fn returns_none_when_absent() {
        assert_eq!(extract_linear_identifier("main", "just a title"), None);
    }

    fn sample_data() -> Value {
        json!({
            "search": {
                "pageInfo": { "hasNextPage": true, "endCursor": "CUR1" },
                "nodes": [
                    {
                        "number": 42, "title": "Add widget", "url": "https://github.com/o/r/pull/42",
                        "isDraft": false, "mergeable": "CONFLICTING", "reviewDecision": "CHANGES_REQUESTED",
                        "updatedAt": "2026-06-20T10:00:00Z",
                        "repository": { "nameWithOwner": "o/r" },
                        "headRefName": "eng-9-widget",
                        "baseRefName": "main",
                        "author": { "login": "octocat", "avatarUrl": "https://a/x.png" },
                        "comments": { "totalCount": 3 },
                        "statusCheckRollup": { "state": "FAILURE" }
                    }
                ]
            }
        })
    }

    #[test]
    fn parses_pr_fields() {
        let (prs, page) = parse_search_page(&sample_data()).unwrap();
        assert_eq!(prs.len(), 1);
        let p = &prs[0];
        assert_eq!(p.id, "o/r#42");
        assert_eq!(p.repo, "o/r");
        assert_eq!(p.number, 42);
        assert_eq!(p.mergeable.as_deref(), Some("conflicting"));
        assert_eq!(p.ci_status.as_deref(), Some("failure"));
        assert_eq!(p.review_decision.as_deref(), Some("changes_requested"));
        assert_eq!(p.comment_count, Some(3));
        assert_eq!(p.branch.as_deref(), Some("eng-9-widget"));
        assert_eq!(p.base_branch.as_deref(), Some("main"));
        assert_eq!(p.linear_identifier.as_deref(), Some("ENG-9"));
        assert_eq!(page.has_next_page, true);
        assert_eq!(page.end_cursor.as_deref(), Some("CUR1"));
    }

    #[test]
    fn null_review_decision_is_preserved() {
        let mut data = sample_data();
        data["search"]["nodes"][0]["reviewDecision"] = Value::Null;
        let (prs, _) = parse_search_page(&data).unwrap();
        assert_eq!(prs[0].review_decision, None);
    }

    #[test]
    fn missing_rollup_maps_to_none_string() {
        let mut data = sample_data();
        data["search"]["nodes"][0]["statusCheckRollup"] = Value::Null;
        let (prs, _) = parse_search_page(&data).unwrap();
        assert_eq!(prs[0].ci_status.as_deref(), Some("none"));
    }

    #[test]
    fn missing_structure_is_malformed() {
        // No `search` object at all -> never silently treat as an empty page,
        // which would let sync transactionally erase a bucket.
        assert!(matches!(
            parse_search_page(&json!({})),
            Err(GitHubError::Malformed)
        ));
        // Missing pageInfo.
        let no_page = json!({ "search": { "nodes": [] } });
        assert!(matches!(
            parse_search_page(&no_page),
            Err(GitHubError::Malformed)
        ));
    }

    #[test]
    fn malformed_pr_node_fails_the_page() {
        // A node missing `number`/`repository` (with is:pr every node IS a PR)
        // must fail the page, not vanish.
        let bad = json!({
            "search": {
                "pageInfo": { "hasNextPage": false, "endCursor": null },
                "nodes": [ { "title": "no number" } ]
            }
        });
        assert!(matches!(
            parse_search_page(&bad),
            Err(GitHubError::Malformed)
        ));
    }
}
