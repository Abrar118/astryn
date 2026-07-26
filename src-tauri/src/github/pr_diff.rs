use serde::Serialize;
use serde_json::Value;

use super::repositories::RepositoryName;
use super::GitHubError;

pub const PR_DIFF_PAGE_SIZE: usize = 100;
pub const PR_DIFF_MAX_PAGES: usize = 30;
pub const PR_DIFF_MAX_FILES: usize = PR_DIFF_PAGE_SIZE * PR_DIFF_MAX_PAGES;

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

fn required_string(value: &Value, key: &str) -> Result<String, GitHubError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(GitHubError::Malformed)
}

fn optional_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn required_count(value: &Value, key: &str) -> Result<i64, GitHubError> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .filter(|count| *count >= 0)
        .ok_or(GitHubError::Malformed)
}

pub fn parse_pr_diff_page(value: &Value) -> Result<Vec<PrDiffFile>, GitHubError> {
    value
        .as_array()
        .ok_or(GitHubError::Malformed)?
        .iter()
        .map(|file| {
            Ok(PrDiffFile {
                path: required_string(file, "filename")?,
                previous_path: optional_string(file, "previous_filename"),
                change_type: required_string(file, "status")?.to_ascii_lowercase(),
                additions: required_count(file, "additions")?,
                deletions: required_count(file, "deletions")?,
                changes: required_count(file, "changes")?,
                patch: optional_string(file, "patch"),
                blob_url: optional_string(file, "blob_url"),
            })
        })
        .collect()
}

pub fn build_pr_diff_path(
    repo: &RepositoryName,
    number: i64,
    page: usize,
) -> Result<String, GitHubError> {
    if number <= 0 || number > i32::MAX as i64 || !(1..=PR_DIFF_MAX_PAGES).contains(&page) {
        return Err(GitHubError::Malformed);
    }
    Ok(format!(
        "/repos/{}/{}/pulls/{number}/files?per_page={PR_DIFF_PAGE_SIZE}&page={page}",
        repo.owner, repo.name
    ))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_text_binary_and_renamed_files() {
        let value = json!([
            {
                "filename": "src/app.ts",
                "status": "modified",
                "additions": 3,
                "deletions": 1,
                "changes": 4,
                "blob_url": "https://github.com/acme/web/blob/head/src/app.ts",
                "patch": "@@ -1,2 +1,4 @@\n-old\n+new"
            },
            {
                "filename": "assets/logo.png",
                "previous_filename": "assets/mark.png",
                "status": "renamed",
                "additions": 0,
                "deletions": 0,
                "changes": 0,
                "blob_url": null
            }
        ]);

        let files = parse_pr_diff_page(&value).expect("valid files");

        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "src/app.ts");
        assert_eq!(
            files[0].patch.as_deref(),
            Some("@@ -1,2 +1,4 @@\n-old\n+new")
        );
        assert_eq!(files[1].previous_path.as_deref(), Some("assets/mark.png"));
        assert_eq!(files[1].patch, None);
        assert_eq!(files[1].blob_url, None);
    }

    #[test]
    fn rejects_missing_required_file_fields() {
        let value = json!([{
            "status": "added",
            "additions": 1,
            "deletions": 0,
            "changes": 1
        }]);

        assert!(matches!(
            parse_pr_diff_page(&value),
            Err(GitHubError::Malformed)
        ));
    }

    #[test]
    fn builds_a_bounded_paginated_rest_path() {
        let repo =
            crate::github::repositories::parse_repository("Acme/Web").expect("valid repository");

        assert_eq!(
            build_pr_diff_path(&repo, 42, 3).expect("valid path"),
            "/repos/Acme/Web/pulls/42/files?per_page=100&page=3"
        );
        assert!(build_pr_diff_path(&repo, 0, 1).is_err());
        assert!(build_pr_diff_path(&repo, 42, 0).is_err());
        assert!(build_pr_diff_path(&repo, 42, 31).is_err());
    }
}
