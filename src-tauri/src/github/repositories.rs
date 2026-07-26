use serde::Serialize;
use serde_json::Value;

use super::GitHubError;

pub const REPOSITORY_CATALOG_PAGE_SIZE: usize = 100;
pub const REPOSITORY_CATALOG_MAX_PAGES: usize = 100;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryCatalog {
    pub repositories: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryName {
    pub canonical: String,
    pub owner: String,
    pub name: String,
    pub scope: String,
}

pub fn parse_repository(input: &str) -> Result<RepositoryName, GitHubError> {
    let canonical = input.trim();
    let (owner, name) = canonical.split_once('/').ok_or(GitHubError::Malformed)?;
    let valid = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
    };
    if !valid(owner) || !valid(name) {
        return Err(GitHubError::Malformed);
    }
    Ok(RepositoryName {
        canonical: canonical.to_string(),
        owner: owner.to_string(),
        name: name.to_string(),
        scope: format!("repo:{}", canonical.to_ascii_lowercase()),
    })
}

pub fn build_repository_search(repo: &RepositoryName) -> String {
    format!("repo:{} is:pr is:open sort:updated-desc", repo.canonical)
}

pub fn build_repository_catalog_path(page: usize) -> Result<String, GitHubError> {
    if !(1..=REPOSITORY_CATALOG_MAX_PAGES).contains(&page) {
        return Err(GitHubError::Malformed);
    }
    Ok(format!(
        "/user/repos?visibility=all&affiliation=owner%2Corganization_member&sort=full_name&direction=asc&per_page={REPOSITORY_CATALOG_PAGE_SIZE}&page={page}"
    ))
}

pub fn parse_repository_catalog_page(value: &Value) -> Result<Vec<String>, GitHubError> {
    value
        .as_array()
        .ok_or(GitHubError::Malformed)?
        .iter()
        .map(|repository| {
            let full_name = repository
                .get("full_name")
                .and_then(Value::as_str)
                .ok_or(GitHubError::Malformed)?;
            parse_repository(full_name).map(|repository| repository.canonical)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn repository_name_is_trimmed_and_scope_is_lowercase() {
        let repo = parse_repository("  Owner/Repo.Name  ").unwrap();
        assert_eq!(repo.canonical, "Owner/Repo.Name");
        assert_eq!(repo.owner, "Owner");
        assert_eq!(repo.name, "Repo.Name");
        assert_eq!(repo.scope, "repo:owner/repo.name");
    }

    #[test]
    fn repository_name_rejects_unsafe_or_incomplete_values() {
        for invalid in [
            "",
            "owner",
            "/repo",
            "owner/",
            "owner/repo/extra",
            "owner/repo sort:created",
            "owner/repo?",
        ] {
            assert!(
                parse_repository(invalid).is_err(),
                "{invalid:?} must be rejected"
            );
        }
    }

    #[test]
    fn favorite_repository_search_is_open_and_recent() {
        let repo = parse_repository("Owner/Repo").unwrap();
        assert_eq!(
            build_repository_search(&repo),
            "repo:Owner/Repo is:pr is:open sort:updated-desc"
        );
    }

    #[test]
    fn repository_catalog_path_requests_owned_and_organization_repositories() {
        assert_eq!(
            build_repository_catalog_path(3).unwrap(),
            "/user/repos?visibility=all&affiliation=owner%2Corganization_member&sort=full_name&direction=asc&per_page=100&page=3"
        );
        assert!(build_repository_catalog_path(0).is_err());
        assert!(build_repository_catalog_path(101).is_err());
    }

    #[test]
    fn repository_catalog_page_parses_and_validates_full_names() {
        let page = parse_repository_catalog_page(&json!([
            { "full_name": "Abrar/personal" },
            { "full_name": "GAM-Health/platform" }
        ]))
        .unwrap();

        assert_eq!(page, vec!["Abrar/personal", "GAM-Health/platform"]);
        assert!(parse_repository_catalog_page(&json!([
            { "full_name": "unsafe/name/extra" }
        ]))
        .is_err());
        assert!(parse_repository_catalog_page(&json!({ "full_name": "o/r" })).is_err());
    }
}
