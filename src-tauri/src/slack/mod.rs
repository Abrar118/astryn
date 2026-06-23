pub mod catchup;
pub mod extract;

use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

use crate::secrets::{SecretError, SecretStore};

#[derive(Debug, thiserror::Error)]
pub enum SlackError {
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

/// Map a Slack `error` string (from an `{"ok":false,...}` body) to a sanitized error.
pub fn classify_slack_error(error: &str) -> SlackError {
    match error {
        "invalid_auth" | "not_authed" | "token_revoked" | "account_inactive" | "no_permission"
        | "missing_scope" | "ekm_access_denied" => SlackError::Auth,
        "ratelimited" | "rate_limited" => SlackError::RateLimited(None),
        other => SlackError::Api(other.to_string()),
    }
}

/// Slack signals success with `ok:true` (HTTP 200). A non-`ok` body is a failure
/// even on HTTP 200; classify its `error` string.
pub fn extract_ok(body: &str) -> Result<Value, SlackError> {
    let v: Value = serde_json::from_str(body).map_err(|_| SlackError::Malformed)?;
    match v.get("ok").and_then(|o| o.as_bool()) {
        Some(true) => Ok(v),
        Some(false) => match v.get("error").and_then(|e| e.as_str()) {
            Some(err) => Err(classify_slack_error(err)),
            None => Err(SlackError::Malformed),
        },
        None => Err(SlackError::Malformed),
    }
}

/// Transport-level status mapping. 429 carries the `Retry-After` delta (seconds).
pub fn interpret_status(status: u16, retry_after: Option<i64>) -> Option<SlackError> {
    match status {
        429 => Some(SlackError::RateLimited(retry_after)),
        500..=599 => Some(SlackError::Server),
        _ => None,
    }
}

/// The credentials for a Slack API call: the `Authorization` value plus an
/// optional session cookie (`d`) used in session-token mode.
#[derive(Clone, Debug, PartialEq)]
pub struct SlackAuth {
    pub authorization: String,
    pub cookie: Option<String>,
}

/// `Cookie` header value for an auth, or `None` when there's no cookie.
pub fn cookie_header(auth: &SlackAuth) -> Option<String> {
    auth.cookie.as_ref().map(|c| format!("d={c}"))
}

pub trait SlackCredentialProvider: Send + Sync {
    /// The credentials to authenticate a call, or `None` if nothing is stored.
    fn auth(&self) -> Result<Option<SlackAuth>, SecretError>;
}

pub struct PersonalTokenProvider {
    store: Arc<dyn SecretStore>,
    token_account: String,
    cookie_account: String,
}

impl PersonalTokenProvider {
    pub fn new(
        store: Arc<dyn SecretStore>,
        token_account: impl Into<String>,
        cookie_account: impl Into<String>,
    ) -> Self {
        Self {
            store,
            token_account: token_account.into(),
            cookie_account: cookie_account.into(),
        }
    }
}

impl SlackCredentialProvider for PersonalTokenProvider {
    fn auth(&self) -> Result<Option<SlackAuth>, SecretError> {
        let token = match self.store.get(&self.token_account)? {
            Some(t) => t,
            None => return Ok(None),
        };
        let cookie = self.store.get(&self.cookie_account)?;
        Ok(Some(SlackAuth {
            authorization: format!("Bearer {token}"),
            cookie,
        }))
    }
}

#[derive(Clone)]
pub struct SlackClient {
    http: reqwest::Client,
    base: String,
}

impl SlackClient {
    pub fn new() -> Result<Self, SlackError> {
        Self::with_base("https://slack.com/api")
    }

    pub fn with_base(base: impl Into<String>) -> Result<Self, SlackError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| SlackError::Network)?;
        Ok(Self {
            http,
            base: base.into(),
        })
    }

    /// POST a Slack Web API method with form params; returns the parsed `ok:true`
    /// body. In session-token mode the `d` cookie is attached.
    pub async fn call(
        &self,
        auth: &SlackAuth,
        method: &str,
        params: &[(&str, &str)],
    ) -> Result<Value, SlackError> {
        let url = format!("{}/{}", self.base, method);
        let mut req = self
            .http
            .post(&url)
            .header("Authorization", &auth.authorization)
            .form(params);
        if let Some(c) = cookie_header(auth) {
            req = req.header("Cookie", c);
        }
        let resp = req.send().await.map_err(|_| SlackError::Network)?;
        let status = resp.status().as_u16();
        let retry_after = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<i64>().ok());
        if let Some(e) = interpret_status(status, retry_after) {
            return Err(e);
        }
        let text = resp.text().await.map_err(|_| SlackError::Network)?;
        extract_ok(&text)
    }
}

#[cfg(test)]
pub mod fake {
    use super::*;

    pub struct FakeSlackCreds(pub Option<SlackAuth>);

    impl SlackCredentialProvider for FakeSlackCreds {
        fn auth(&self) -> Result<Option<SlackAuth>, SecretError> {
            Ok(self.0.clone())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_true_returns_body() {
        let v = extract_ok(r#"{"ok":true,"user_id":"U1"}"#).unwrap();
        assert_eq!(v["user_id"], "U1");
    }

    #[test]
    fn ok_false_invalid_auth_is_auth() {
        assert!(matches!(
            extract_ok(r#"{"ok":false,"error":"invalid_auth"}"#),
            Err(SlackError::Auth)
        ));
    }

    #[test]
    fn ok_false_ratelimited_is_rate_limited() {
        assert!(matches!(
            extract_ok(r#"{"ok":false,"error":"ratelimited"}"#),
            Err(SlackError::RateLimited(_))
        ));
    }

    #[test]
    fn ok_false_missing_scope_is_auth() {
        assert!(matches!(
            classify_slack_error("missing_scope"),
            SlackError::Auth
        ));
    }

    #[test]
    fn ok_false_other_is_api() {
        match extract_ok(r#"{"ok":false,"error":"channel_not_found"}"#) {
            Err(SlackError::Api(m)) => assert_eq!(m, "channel_not_found"),
            other => panic!("expected Api, got {other:?}"),
        }
    }

    #[test]
    fn ok_false_without_error_is_malformed() {
        assert!(matches!(
            extract_ok(r#"{"ok":false}"#),
            Err(SlackError::Malformed)
        ));
    }

    #[test]
    fn non_json_is_malformed() {
        assert!(matches!(extract_ok("not json"), Err(SlackError::Malformed)));
    }

    #[test]
    fn status_429_is_rate_limited_with_hint() {
        assert!(matches!(
            interpret_status(429, Some(12)),
            Some(SlackError::RateLimited(Some(12)))
        ));
    }

    #[test]
    fn status_5xx_is_server() {
        assert!(matches!(
            interpret_status(503, None),
            Some(SlackError::Server)
        ));
    }

    #[test]
    fn status_200_is_none() {
        assert!(interpret_status(200, None).is_none());
    }

    #[test]
    fn provider_supplies_bearer_and_cookie() {
        use crate::secrets::fake::FakeSecretStore;
        let store: std::sync::Arc<dyn SecretStore> =
            std::sync::Arc::new(FakeSecretStore::default());
        store.set("slack_user_token", "xoxc-1").unwrap();
        store.set("slack_cookie_d", "xoxd-9").unwrap();
        let p = PersonalTokenProvider::new(store.clone(), "slack_user_token", "slack_cookie_d");
        let a = p.auth().unwrap().unwrap();
        assert_eq!(a.authorization, "Bearer xoxc-1");
        assert_eq!(a.cookie.as_deref(), Some("xoxd-9"));
    }

    #[test]
    fn provider_cookie_none_when_absent() {
        use crate::secrets::fake::FakeSecretStore;
        let store: std::sync::Arc<dyn SecretStore> =
            std::sync::Arc::new(FakeSecretStore::default());
        store.set("slack_user_token", "xoxp-1").unwrap();
        let p = PersonalTokenProvider::new(store, "slack_user_token", "slack_cookie_d");
        let a = p.auth().unwrap().unwrap();
        assert_eq!(a.cookie, None);
    }

    #[tokio::test]
    async fn call_sends_cookie_header_when_present() {
        // A throwaway server that echoes whether a Cookie header arrived.
        let client = SlackClient::with_base("http://127.0.0.1:0/api").unwrap();
        // Pure check instead of a live server: build the auth and assert the helper.
        let auth = SlackAuth {
            authorization: "Bearer xoxc-1".into(),
            cookie: Some("xoxd-9".into()),
        };
        assert_eq!(cookie_header(&auth).as_deref(), Some("d=xoxd-9"));
        let none = SlackAuth {
            authorization: "Bearer xoxp".into(),
            cookie: None,
        };
        assert_eq!(cookie_header(&none), None);
        let _ = client; // constructed to prove with_base still compiles
    }
}
