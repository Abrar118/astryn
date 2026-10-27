use regex::Regex;
use std::sync::OnceLock;

fn identifier_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\b[A-Z][A-Z0-9]*-\d+\b").unwrap())
}

/// Extract a Linear issue identifier (e.g. "ENG-123") from a branch name or PR
/// title, normalized to uppercase. Branch wins over title. Shared by the GitHub
/// and Slack modules so neither depends on the other.
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
