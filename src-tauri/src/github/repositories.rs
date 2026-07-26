use super::GitHubError;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
