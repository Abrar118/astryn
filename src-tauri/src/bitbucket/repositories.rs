//! Repository catalog for the favorite-repository picker.

use serde_json::Value;

use super::{page_values, BitbucketError};
use crate::code_host::parse_repo_name;

/// Total page budget across all workspaces (100 repositories per page).
pub const CATALOG_MAX_PAGES: usize = 100;

/// Repositories in `workspace` the viewer can read, names only.
pub fn catalog_path(workspace: &str) -> Result<String, BitbucketError> {
    if parse_repo_name(&format!("{workspace}/x")).is_none() {
        return Err(BitbucketError::Malformed);
    }
    Ok(format!(
        "/repositories/{workspace}?role=member&pagelen=100&sort=slug&fields=next,values.full_name"
    ))
}

/// `values[].full_name` of one page, each validated as `workspace/slug`.
pub fn parse_catalog_page(page: &Value) -> Result<Vec<String>, BitbucketError> {
    page_values(page)?
        .iter()
        .map(|repo| {
            let name = repo
                .get("full_name")
                .and_then(Value::as_str)
                .ok_or(BitbucketError::Malformed)?;
            parse_repo_name(name)
                .map(|r| r.canonical)
                .ok_or(BitbucketError::Malformed)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn catalog_path_is_member_scoped_and_validated() {
        assert_eq!(
            catalog_path("acme").unwrap(),
            "/repositories/acme?role=member&pagelen=100&sort=slug&fields=next,values.full_name"
        );
        assert!(catalog_path("..").is_err());
        assert!(catalog_path("a b").is_err());
    }

    #[test]
    fn catalog_page_parses_full_names() {
        let page = json!({ "values": [
            { "full_name": "acme/api" },
            { "full_name": "acme/web.app" }
        ], "next": "https://api.bitbucket.org/2.0/repositories/acme?page=2" });
        assert_eq!(
            parse_catalog_page(&page).unwrap(),
            vec!["acme/api", "acme/web.app"]
        );
        assert!(parse_catalog_page(&json!({ "values": [{ "full_name": "x" }] })).is_err());
        assert!(parse_catalog_page(&json!([])).is_err());
    }
}
