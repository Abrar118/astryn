use crate::link_preview::PreviewError;

/// Validate an untrusted preview URL's static shape (scheme, credentials,
/// host present). Address-range checks happen later, after DNS resolution,
/// in the fetcher. Returns the parsed `reqwest::Url` on success.
pub fn validate_preview_url(value: &str) -> Result<reqwest::Url, PreviewError> {
    let url = reqwest::Url::parse(value).map_err(|_| PreviewError::Unsupported)?;
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(PreviewError::Unsupported);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(PreviewError::Unsupported);
    }
    // Belt-and-suspenders: the URL parser already rejects empty/absent hosts for http/https,
    // but we keep this guard as defense-in-depth in case of future scheme-allowlist changes.
    if url.host_str().is_none() {
        return Err(PreviewError::Unsupported);
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_https() {
        let u = validate_preview_url("https://example.com/path?q=1").unwrap();
        assert_eq!(u.host_str(), Some("example.com"));
    }

    #[test]
    fn accepts_http_and_explicit_port() {
        assert!(validate_preview_url("http://example.com:8080/").is_ok());
    }

    #[test]
    fn rejects_non_http_schemes() {
        for s in [
            "ftp://example.com",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,x",
        ] {
            assert_eq!(
                validate_preview_url(s),
                Err(PreviewError::Unsupported),
                "{s}"
            );
        }
    }

    #[test]
    fn rejects_credentials_in_url() {
        assert_eq!(
            validate_preview_url("https://user:pass@example.com/"),
            Err(PreviewError::Unsupported)
        );
        assert_eq!(
            validate_preview_url("https://user@example.com/"),
            Err(PreviewError::Unsupported)
        );
    }

    #[test]
    fn rejects_missing_host_and_garbage() {
        assert_eq!(
            validate_preview_url("https://"),
            Err(PreviewError::Unsupported)
        );
        assert_eq!(
            validate_preview_url("not a url"),
            Err(PreviewError::Unsupported)
        );
    }
}
