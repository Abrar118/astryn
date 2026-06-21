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
        [Bucket::NeedsReview, Bucket::Mine, Bucket::Assigned, Bucket::Involved]
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
}
