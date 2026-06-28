use serde_json::Value;

use super::GitHubError;

/// The configurable origin of the docs repo (owner/repo/branch). Stored in the
/// `settings` table — never hardcoded, so a public Astryn build doesn't expose a
/// private docs repo, and the user can repoint it.
#[derive(Debug, Clone, PartialEq)]
pub struct DocsOrigin {
    pub owner: String,
    pub repo: String,
    pub branch: String,
}

/// Parse a GitHub repo reference into owner/repo/branch. Accepts a full URL
/// (`https://github.com/owner/repo`, `.../tree/<branch>`, optionally `.git` or a
/// trailing slash), a host-relative `github.com/owner/repo`, or a bare
/// `owner/repo`. Branch defaults to `main` when absent; a `tree/<branch>` segment
/// may itself contain slashes (e.g. `feature/x`). Returns `None` for anything
/// without at least an owner and repo.
pub fn parse_docs_origin(input: &str) -> Option<DocsOrigin> {
    let mut s = input.trim();
    for scheme in ["https://", "http://"] {
        if let Some(rest) = s.strip_prefix(scheme) {
            s = rest;
            break;
        }
    }
    for host in ["www.github.com/", "github.com/"] {
        if let Some(rest) = s.strip_prefix(host) {
            s = rest;
            break;
        }
    }
    let s = s.trim_end_matches('/');
    let parts: Vec<&str> = s.split('/').collect();
    if parts.len() < 2 {
        return None;
    }
    let owner = parts[0].trim();
    let repo = parts[1].trim().trim_end_matches(".git");
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    let branch = if parts.len() >= 4 && parts[2] == "tree" {
        parts[3..].join("/")
    } else {
        "main".to_string()
    };
    if branch.is_empty() {
        return None;
    }
    Some(DocsOrigin {
        owner: owner.to_string(),
        repo: repo.to_string(),
        branch,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawEntry {
    pub path: String,
    pub kind: String, // "blob" | "tree"
    pub sha: String,
}

/// REST path for the recursive git tree of the docs repo's configured branch.
pub fn tree_path(origin: &DocsOrigin) -> String {
    format!(
        "/repos/{}/{}/git/trees/{}?recursive=1",
        origin.owner, origin.repo, origin.branch
    )
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

/// Parse a `git/trees?recursive=1` response into entries, the `truncated` flag,
/// and the tree's own top-level sha (used as a cheap "unchanged since last sync"
/// short-circuit in future).
/// Entries missing path/type/sha are skipped (e.g. submodule `commit` rows).
pub fn parse_tree(data: &Value) -> Result<(Vec<RawEntry>, bool, Option<String>), GitHubError> {
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
    let tree_sha = data.get("sha").and_then(|s| s.as_str()).map(String::from);
    Ok((out, truncated, tree_sha))
}

/// GraphQL body reading one file's text via `repository.object(expression:"<branch>:<path>")`.
pub fn content_query_body(origin: &DocsOrigin, path: &str) -> Value {
    serde_json::json!({
        "query": "query($owner:String!,$name:String!,$expr:String!){ \
                    repository(owner:$owner,name:$name){ \
                      object(expression:$expr){ ... on Blob { text } } } }",
        "variables": {
            "owner": origin.owner,
            "name": origin.repo,
            "expr": format!("{}:{}", origin.branch, path)
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
        assert_eq!(
            parent_path("02-technical/backend/README.md"),
            "02-technical/backend"
        );
        assert_eq!(basename("README.md"), "README.md");
        assert_eq!(parent_path("README.md"), "");
    }

    fn origin(owner: &str, repo: &str, branch: &str) -> DocsOrigin {
        DocsOrigin {
            owner: owner.into(),
            repo: repo.into(),
            branch: branch.into(),
        }
    }

    #[test]
    fn tree_path_targets_recursive_configured_branch() {
        assert_eq!(
            tree_path(&origin("acme", "docs", "main")),
            "/repos/acme/docs/git/trees/main?recursive=1"
        );
    }

    #[test]
    fn parse_docs_origin_accepts_plain_repo_url() {
        assert_eq!(
            parse_docs_origin("https://github.com/acme/docs"),
            Some(origin("acme", "docs", "main"))
        );
    }

    #[test]
    fn parse_docs_origin_reads_branch_from_tree_url() {
        assert_eq!(
            parse_docs_origin("https://github.com/acme/docs/tree/release"),
            Some(origin("acme", "docs", "release"))
        );
    }

    #[test]
    fn parse_docs_origin_handles_dotgit_trailing_slash_and_bare_forms() {
        assert_eq!(
            parse_docs_origin("https://github.com/acme/docs.git"),
            Some(origin("acme", "docs", "main"))
        );
        assert_eq!(
            parse_docs_origin("https://github.com/acme/docs/"),
            Some(origin("acme", "docs", "main"))
        );
        assert_eq!(
            parse_docs_origin("github.com/acme/docs"),
            Some(origin("acme", "docs", "main"))
        );
        assert_eq!(
            parse_docs_origin("acme/docs"),
            Some(origin("acme", "docs", "main"))
        );
    }

    #[test]
    fn parse_docs_origin_preserves_slashed_branch() {
        assert_eq!(
            parse_docs_origin("https://github.com/acme/docs/tree/feature/x"),
            Some(origin("acme", "docs", "feature/x"))
        );
    }

    #[test]
    fn parse_docs_origin_rejects_incomplete_input() {
        assert_eq!(parse_docs_origin(""), None);
        assert_eq!(parse_docs_origin("https://github.com/acme"), None);
        assert_eq!(parse_docs_origin("acme"), None);
    }

    #[test]
    fn parse_tree_extracts_entries_and_truncated() {
        let data = serde_json::json!({
            "sha": "tree123",
            "tree": [
                { "path": "00-overview", "type": "tree", "sha": "t1" },
                { "path": "00-overview/intro.md", "type": "blob", "sha": "b1" },
                { "path": "weird", "type": "commit" }  // missing sha → skipped
            ],
            "truncated": true
        });
        let (entries, truncated, tree_sha) = parse_tree(&data).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(
            entries[1],
            RawEntry {
                path: "00-overview/intro.md".into(),
                kind: "blob".into(),
                sha: "b1".into()
            }
        );
        assert!(truncated);
        assert_eq!(tree_sha, Some("tree123".to_string()));
    }

    #[test]
    fn parse_tree_missing_array_is_malformed() {
        assert!(matches!(
            parse_tree(&serde_json::json!({})),
            Err(GitHubError::Malformed)
        ));
    }

    #[test]
    fn content_query_body_binds_branch_scoped_expression() {
        let body = content_query_body(&origin("acme", "docs", "release"), "a/b.md");
        assert_eq!(body["variables"]["expr"], "release:a/b.md");
        assert_eq!(body["variables"]["owner"], "acme");
        assert_eq!(body["variables"]["name"], "docs");
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
