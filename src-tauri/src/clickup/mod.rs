//! ClickUp provider: credential seam and a small REST client. All ClickUp HTTP
//! runs here in Rust; the token never reaches the webview.

pub mod docs;

use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::secrets::{SecretError, SecretStore};

pub const API_BASE: &str = "https://api.clickup.com/api";

#[derive(Debug, thiserror::Error)]
pub enum ClickUpError {
    #[error("network error")]
    Network,
    #[error("authentication failed")]
    Auth,
    /// Seconds until the rate-limit window resets, when ClickUp said.
    #[error("rate limited")]
    RateLimited(Option<i64>),
    #[error("malformed response")]
    Malformed,
    #[error("server error")]
    Server,
    #[error("api error: {0}")]
    Api(String),
}

/// Map an HTTP status to an error (`None` for 2xx). ClickUp answers a bad or
/// revoked token with 401 (and some workspace-permission failures with 403).
pub fn interpret_status(status: u16) -> Option<ClickUpError> {
    match status {
        200..=299 => None,
        401 | 403 => Some(ClickUpError::Auth),
        429 => Some(ClickUpError::RateLimited(None)),
        500..=599 => Some(ClickUpError::Server),
        other => Some(ClickUpError::Api(format!("HTTP {other}"))),
    }
}

/// Parse a 2xx body. ClickUp reports some failures as `{ "err": "...", "ECODE": "..." }`,
/// which is a failure even on HTTP 200.
pub fn parse_body(text: &str) -> Result<Value, ClickUpError> {
    let v: Value = serde_json::from_str(text).map_err(|_| ClickUpError::Malformed)?;
    if let Some(err) = v.get("err").and_then(|e| e.as_str()) {
        let code = v.get("ECODE").and_then(|c| c.as_str()).unwrap_or("");
        return Err(ClickUpError::Api(
            format!("{code} {err}").trim().to_string(),
        ));
    }
    Ok(v)
}

/// Seconds until `x-ratelimit-reset` (an epoch-seconds timestamp).
pub fn rate_limit_hint(reset_epoch: Option<i64>, now: i64) -> Option<i64> {
    reset_epoch.map(|reset| (reset - now).max(0))
}

pub trait ClickUpCredentialProvider: Send + Sync {
    /// The `Authorization` header value, or `None` if no token is stored.
    fn authorization(&self) -> Result<Option<String>, SecretError>;
}

/// A personal API token (`pk_…`) from the keychain, sent raw (no `Bearer`).
pub struct PersonalTokenProvider {
    store: Arc<dyn SecretStore>,
    account: String,
}

impl PersonalTokenProvider {
    pub fn new(store: Arc<dyn SecretStore>, account: impl Into<String>) -> Self {
        Self {
            store,
            account: account.into(),
        }
    }
}

impl ClickUpCredentialProvider for PersonalTokenProvider {
    fn authorization(&self) -> Result<Option<String>, SecretError> {
        self.store.get(&self.account)
    }
}

#[derive(Clone)]
pub struct ClickUpClient {
    http: reqwest::Client,
    base: String,
}

impl ClickUpClient {
    pub fn new() -> Result<Self, ClickUpError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| ClickUpError::Network)?;
        Ok(Self {
            http,
            base: API_BASE.to_string(),
        })
    }

    /// GET `{base}{path}` (path starts with `/v2/…` or `/v3/…`) and return the
    /// parsed JSON body.
    pub async fn get(&self, authorization: &str, path: &str) -> Result<Value, ClickUpError> {
        let resp = self
            .http
            .get(format!("{}{path}", self.base))
            .header("Authorization", authorization)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|_| ClickUpError::Network)?;
        let status = resp.status().as_u16();
        let reset = resp
            .headers()
            .get("x-ratelimit-reset")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<i64>().ok());
        let text = resp.text().await.map_err(|_| ClickUpError::Network)?;
        if let Some(e) = interpret_status(status) {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            return Err(match e {
                ClickUpError::RateLimited(_) => {
                    ClickUpError::RateLimited(rate_limit_hint(reset, now))
                }
                other => other,
            });
        }
        parse_body(&text)
    }
}

#[cfg(test)]
pub mod fake {
    use super::*;

    pub struct FakeClickUpCreds(pub Option<String>);

    impl ClickUpCredentialProvider for FakeClickUpCreds {
        fn authorization(&self) -> Result<Option<String>, SecretError> {
            Ok(self.0.clone())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::fake::FakeSecretStore;

    #[test]
    fn statuses_map_to_errors() {
        assert!(interpret_status(200).is_none());
        assert!(matches!(interpret_status(401), Some(ClickUpError::Auth)));
        assert!(matches!(interpret_status(403), Some(ClickUpError::Auth)));
        assert!(matches!(
            interpret_status(429),
            Some(ClickUpError::RateLimited(_))
        ));
        assert!(matches!(interpret_status(503), Some(ClickUpError::Server)));
        assert!(matches!(interpret_status(404), Some(ClickUpError::Api(_))));
    }

    #[test]
    fn an_err_body_is_a_failure_even_on_200() {
        assert!(matches!(
            parse_body(r#"{"err":"Token invalid","ECODE":"OAUTH_025"}"#),
            Err(ClickUpError::Api(m)) if m == "OAUTH_025 Token invalid"
        ));
        assert!(matches!(parse_body("<html>"), Err(ClickUpError::Malformed)));
        assert_eq!(parse_body(r#"{"id":"1"}"#).unwrap()["id"], "1");
    }

    #[test]
    fn rate_limit_hint_counts_down_to_the_reset() {
        assert_eq!(rate_limit_hint(Some(1_100), 1_000), Some(100));
        assert_eq!(rate_limit_hint(Some(900), 1_000), Some(0));
        assert_eq!(rate_limit_hint(None, 1_000), None);
    }

    #[test]
    fn personal_tokens_are_sent_raw() {
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let provider = PersonalTokenProvider::new(store.clone(), "clickup_token");
        assert_eq!(provider.authorization().unwrap(), None);
        store.set("clickup_token", "pk_123_ABC").unwrap();
        assert_eq!(
            provider.authorization().unwrap().as_deref(),
            Some("pk_123_ABC")
        );
    }
}
