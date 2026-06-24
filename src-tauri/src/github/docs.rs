use serde_json::Value;

use super::GitHubError;

pub const DOCS_OWNER: &str = "GAM-Health-Solutions";
pub const DOCS_REPO: &str = "core-psycloud-docs";
pub const DOCS_BRANCH: &str = "main";

#[derive(Debug, Clone, PartialEq)]
pub struct RawEntry {
    pub path: String,
    pub kind: String, // "blob" | "tree"
    pub sha: String,
}

/// REST path for the recursive git tree of the docs repo's default branch.
pub fn tree_path() -> String {
    format!("/repos/{DOCS_OWNER}/{DOCS_REPO}/git/trees/{DOCS_BRANCH}?recursive=1")
}

/// True for a markdown file path (case-insensitive `.md`).
pub fn is_markdown(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".md")
}

/// Last path segment.
pub fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Parent directory path (`""` for a top-level entry).
pub fn parent_path(path: &str) -> &str {
    match path.rfind('/') {
        Some(i) => &path[..i],
        None => "",
    }
}

/// Parse a `git/trees?recursive=1` response into entries + the `truncated` flag.
/// Entries missing path/type/sha are skipped (e.g. submodule `commit` rows).
pub fn parse_tree(data: &Value) -> Result<(Vec<RawEntry>, bool), GitHubError> {
    let arr = data
        .get("tree")
        .and_then(|t| t.as_array())
        .ok_or(GitHubError::Malformed)?;
    let mut out = Vec::new();
    for e in arr {
        let path = e.get("path").and_then(|p| p.as_str());
        let kind = e.get("type").and_then(|p| p.as_str());
        let sha = e.get("sha").and_then(|p| p.as_str());
        if let (Some(path), Some(kind), Some(sha)) = (path, kind, sha) {
            out.push(RawEntry {
                path: path.to_string(),
                kind: kind.to_string(),
                sha: sha.to_string(),
            });
        }
    }
    let truncated = data
        .get("truncated")
        .and_then(|t| t.as_bool())
        .unwrap_or(false);
    Ok((out, truncated))
}

/// GraphQL body reading one file's text via `repository.object(expression:"main:<path>")`.
pub fn content_query_body(path: &str) -> Value {
    serde_json::json!({
        "query": "query($owner:String!,$name:String!,$expr:String!){ \
                    repository(owner:$owner,name:$name){ \
                      object(expression:$expr){ ... on Blob { text } } } }",
        "variables": {
            "owner": DOCS_OWNER,
            "name": DOCS_REPO,
            "expr": format!("{DOCS_BRANCH}:{path}")
        }
    })
}

/// Extract blob text from a content query's `data`. A null/absent object (deleted
/// or binary blob) yields an empty string rather than an error.
pub fn parse_blob_text(data: &Value) -> Result<String, GitHubError> {
    match data.get("repository").and_then(|r| r.get("object")) {
        None | Some(Value::Null) => Ok(String::new()),
        Some(obj) => Ok(obj
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_detection_is_case_insensitive() {
        assert!(is_markdown("a/b.md"));
        assert!(is_markdown("README.MD"));
        assert!(!is_markdown("a/b.png"));
        assert!(!is_markdown("a/b"));
    }

    #[test]
    fn basename_and_parent_split_paths() {
        assert_eq!(basename("02-technical/backend/README.md"), "README.md");
        assert_eq!(parent_path("02-technical/backend/README.md"), "02-technical/backend");
        assert_eq!(basename("README.md"), "README.md");
        assert_eq!(parent_path("README.md"), "");
    }

    #[test]
    fn tree_path_targets_recursive_default_branch() {
        assert_eq!(
            tree_path(),
            "/repos/GAM-Health-Solutions/core-psycloud-docs/git/trees/main?recursive=1"
        );
    }

    #[test]
    fn parse_tree_extracts_entries_and_truncated() {
        let data = serde_json::json!({
            "tree": [
                { "path": "00-overview", "type": "tree", "sha": "t1" },
                { "path": "00-overview/intro.md", "type": "blob", "sha": "b1" },
                { "path": "weird", "type": "commit" }  // missing sha → skipped
            ],
            "truncated": true
        });
        let (entries, truncated) = parse_tree(&data).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1], RawEntry { path: "00-overview/intro.md".into(), kind: "blob".into(), sha: "b1".into() });
        assert!(truncated);
    }

    #[test]
    fn parse_tree_missing_array_is_malformed() {
        assert!(matches!(parse_tree(&serde_json::json!({})), Err(GitHubError::Malformed)));
    }

    #[test]
    fn content_query_body_binds_branch_scoped_expression() {
        let body = content_query_body("a/b.md");
        assert_eq!(body["variables"]["expr"], "main:a/b.md");
        assert_eq!(body["variables"]["owner"], "GAM-Health-Solutions");
        assert!(body["query"].as_str().unwrap().contains("on Blob"));
    }

    #[test]
    fn parse_blob_text_reads_text() {
        let data = serde_json::json!({ "repository": { "object": { "text": "# Hi" } } });
        assert_eq!(parse_blob_text(&data).unwrap(), "# Hi");
    }

    #[test]
    fn parse_blob_text_null_object_is_empty() {
        let data = serde_json::json!({ "repository": { "object": Value::Null } });
        assert_eq!(parse_blob_text(&data).unwrap(), "");
    }
}
