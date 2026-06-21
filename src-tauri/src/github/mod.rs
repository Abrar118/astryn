pub mod prs;

use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::secrets::{SecretError, SecretStore};

#[derive(Debug, thiserror::Error)]
pub enum GitHubError {
    #[error("network error")]
    Network,
    #[error("authentication failed")]
    Auth,
    #[error("rate limited")]
    RateLimited(Option<i64>),
    #[error("malformed response")]
    Malformed,
    #[error("server error")]
    Server,
    #[error("api error: {0}")]
    Api(String),
}

/// Classify a non-empty GraphQL `errors` array. GitHub primary rate limits arrive
/// as HTTP 200 with `type: "RATE_LIMITED"`.
pub fn classify_graphql_errors(errors: &[Value]) -> GitHubError {
    let throttled = errors.iter().any(|e| {
        e.get("type").and_then(|t| t.as_str()) == Some("RATE_LIMITED")
    });
    if throttled {
        return GitHubError::RateLimited(None);
    }
    let joined = errors
        .iter()
        .filter_map(|e| e.get("message").and_then(|m| m.as_str()))
        .collect::<Vec<_>>()
        .join("; ");
    if joined.is_empty() {
        return GitHubError::Malformed;
    }
    GitHubError::Api(joined)
}

/// Parse a GraphQL body to its `data` object, treating a non-empty `errors`
/// array as a failure even on HTTP 200.
pub fn extract_data(body: &str) -> Result<Value, GitHubError> {
    let v: Value = serde_json::from_str(body).map_err(|_| GitHubError::Malformed)?;
    if let Some(errors) = v.get("errors").and_then(|e| e.as_array()) {
        if !errors.is_empty() {
            return Err(classify_graphql_errors(errors));
        }
    }
    v.get("data").cloned().ok_or(GitHubError::Malformed)
}

/// Map transport statuses to errors. 403 is a *secondary* rate limit when the
/// caller detected throttling headers, otherwise an auth/API failure. The hint
/// is filled by the caller (`graphql`) from headers.
pub fn interpret_status(status: u16, throttled: bool) -> Option<GitHubError> {
    match status {
        401 => Some(GitHubError::Auth),
        403 if throttled => Some(GitHubError::RateLimited(None)),
        403 => Some(GitHubError::Auth),
        429 => Some(GitHubError::RateLimited(None)),
        500..=599 => Some(GitHubError::Server),
        _ => None,
    }
}

/// Best available rate-limit delay (seconds): prefer `retry-after` (already a
/// delta), else derive from the `x-ratelimit-reset` epoch minus `now`.
pub fn rate_limit_hint(retry_after: Option<i64>, reset_epoch: Option<i64>, now: i64) -> Option<i64> {
    retry_after.or_else(|| reset_epoch.map(|reset| (reset - now).max(0)))
}

pub trait GitHubCredentialProvider: Send + Sync {
    /// Returns the value for the `Authorization` header, or `None` if no token is stored.
    fn authorization(&self) -> Result<Option<String>, SecretError>;
}

pub struct PatProvider {
    store: Arc<dyn SecretStore>,
    account: String,
}

impl PatProvider {
    pub fn new(store: Arc<dyn SecretStore>, account: impl Into<String>) -> Self {
        Self { store, account: account.into() }
    }
}

impl GitHubCredentialProvider for PatProvider {
    fn authorization(&self) -> Result<Option<String>, SecretError> {
        // Classic PATs are sent as a Bearer credential.
        Ok(self.store.get(&self.account)?.map(|t| format!("Bearer {t}")))
    }
}

#[derive(Clone)]
pub struct GitHubClient {
    http: reqwest::Client,
    endpoint: String,
}

impl GitHubClient {
    pub fn new() -> Result<Self, GitHubError> {
        Self::with_endpoint("https://api.github.com/graphql")
    }

    pub fn with_endpoint(endpoint: impl Into<String>) -> Result<Self, GitHubError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| GitHubError::Network)?;
        Ok(Self { http, endpoint: endpoint.into() })
    }

    /// POST a GraphQL body; returns the parsed `data` object. Detects 429/403
    /// throttling from headers and HTTP-200-with-errors via `extract_data`.
    pub async fn graphql(
        &self,
        authorization: &str,
        body: Value,
    ) -> Result<Value, GitHubError> {
        let resp = self
            .http
            .post(&self.endpoint)
            .header("Authorization", authorization)
            .header("User-Agent", "astryn")
            .json(&body)
            .send()
            .await
            .map_err(|_| GitHubError::Network)?;
        let status = resp.status().as_u16();
        let h = resp.headers();
        let num = |name: &str| {
            h.get(name).and_then(|v| v.to_str().ok()).and_then(|s| s.parse::<i64>().ok())
        };
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let hint = rate_limit_hint(num("retry-after"), num("x-ratelimit-reset"), now);
        let remaining = num("x-ratelimit-remaining");
        let throttled = hint.is_some() || remaining == Some(0);
        let text = resp.text().await.map_err(|_| GitHubError::Network)?;
        if let Some(e) = interpret_status(status, throttled) {
            return Err(match e {
                GitHubError::RateLimited(_) => GitHubError::RateLimited(hint),
                other => other,
            });
        }
        // HTTP-200-with-errors path: a GraphQL RATE_LIMITED loses its hint inside
        // extract_data — re-attach the header-derived hint here.
        match extract_data(&text) {
            Err(GitHubError::RateLimited(_)) => Err(GitHubError::RateLimited(hint)),
            other => other,
        }
    }
}

#[cfg(test)]
pub mod fake {
    use super::*;

    /// A credential provider that returns a fixed authorization value.
    pub struct FakeGitHubCreds(pub Option<String>);

    impl GitHubCredentialProvider for FakeGitHubCreds {
        fn authorization(&self) -> Result<Option<String>, SecretError> {
            Ok(self.0.clone())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graphql_rate_limited_is_classified() {
        let errs = vec![serde_json::json!({"type": "RATE_LIMITED", "message": "wait"})];
        assert!(matches!(
            classify_graphql_errors(&errs),
            GitHubError::RateLimited(_)
        ));
    }

    #[test]
    fn graphql_other_errors_join_messages() {
        let errs = vec![serde_json::json!({"message": "bad field"})];
        match classify_graphql_errors(&errs) {
            GitHubError::Api(m) => assert_eq!(m, "bad field"),
            other => panic!("expected Api, got {other:?}"),
        }
    }

    #[test]
    fn extract_data_treats_errors_as_failure() {
        let body = r#"{"errors":[{"message":"nope"}],"data":null}"#;
        assert!(matches!(extract_data(body), Err(GitHubError::Api(_))));
    }

    #[test]
    fn extract_data_returns_data_object() {
        let body = r#"{"data":{"viewer":{"login":"octocat"}}}"#;
        let v = extract_data(body).unwrap();
        assert_eq!(v["viewer"]["login"], "octocat");
    }

    #[test]
    fn status_401_is_auth() {
        assert!(matches!(interpret_status(401, false), Some(GitHubError::Auth)));
    }

    #[test]
    fn status_403_throttled_is_rate_limited() {
        assert!(matches!(
            interpret_status(403, true),
            Some(GitHubError::RateLimited(_))
        ));
    }

    #[test]
    fn status_403_unthrottled_is_auth() {
        assert!(matches!(interpret_status(403, false), Some(GitHubError::Auth)));
    }

    #[test]
    fn status_200_is_none() {
        assert!(interpret_status(200, false).is_none());
    }

    #[test]
    fn rate_limit_hint_prefers_retry_after() {
        assert_eq!(rate_limit_hint(Some(30), Some(9_999), 1_000), Some(30));
    }

    #[test]
    fn rate_limit_hint_derives_delta_from_reset_epoch() {
        assert_eq!(rate_limit_hint(None, Some(1_100), 1_000), Some(100));
    }

    #[test]
    fn rate_limit_hint_none_when_absent() {
        assert_eq!(rate_limit_hint(None, None, 1_000), None);
    }

    #[test]
    fn rate_limit_hint_clamps_past_reset_to_zero() {
        assert_eq!(rate_limit_hint(None, Some(900), 1_000), Some(0));
    }

    #[test]
    fn graphql_errors_without_message_are_malformed() {
        let errs = vec![serde_json::json!({"extensions": {"code": "X"}})];
        assert!(matches!(classify_graphql_errors(&errs), GitHubError::Malformed));
    }

    #[test]
    fn status_429_is_rate_limited() {
        assert!(matches!(interpret_status(429, false), Some(GitHubError::RateLimited(_))));
    }
}
