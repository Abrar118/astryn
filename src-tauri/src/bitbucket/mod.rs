//! Bitbucket Cloud (REST API 2.0) code-host provider: credential seam, HTTP
//! client, and wire-format parsers that produce the provider-neutral
//! `code_host` shapes.

pub mod pr_detail;
pub mod pr_diff;
pub mod prs;
pub mod repositories;

use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use serde_json::Value;

use crate::secrets::{SecretError, SecretStore};

/// Every request goes to this API root; pagination `next` links are accepted
/// only when they stay under it, so the credential never leaves the host.
pub const API_ROOT: &str = "https://api.bitbucket.org/2.0";

/// Pull request list pages are capped at 50 by Bitbucket.
pub const PR_PAGE_LEN: usize = 50;
/// Cap for raw diff bodies; larger diffs are truncated.
pub const DIFF_MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum BitbucketError {
    #[error("network error")]
    Network,
    #[error("authentication failed")]
    Auth,
    #[error("rate limited")]
    RateLimited,
    #[error("malformed response")]
    Malformed,
    #[error("server error")]
    Server,
    #[error("api error")]
    Api,
}

/// Map an HTTP status to an error; `None` for 2xx.
pub fn interpret_status(status: u16) -> Option<BitbucketError> {
    match status {
        200..=299 => None,
        401 | 403 => Some(BitbucketError::Auth),
        429 => Some(BitbucketError::RateLimited),
        500..=599 => Some(BitbucketError::Server),
        _ => Some(BitbucketError::Api),
    }
}

/// Resolve a request target: an API-relative path (`/user`) or an absolute
/// `next` link, which must stay under `API_ROOT`.
pub fn resolve_url(target: &str) -> Result<String, BitbucketError> {
    if target.starts_with('/') && !target.starts_with("//") {
        return Ok(format!("{API_ROOT}{target}"));
    }
    if target.starts_with(&format!("{API_ROOT}/")) && !target.contains('@') {
        return Ok(target.to_string());
    }
    Err(BitbucketError::Malformed)
}

/// A paginated response's `next` link, validated against `API_ROOT`.
pub fn next_link(page: &Value) -> Result<Option<String>, BitbucketError> {
    match page.get("next") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(next)) => resolve_url(next).map(Some),
        Some(_) => Err(BitbucketError::Malformed),
    }
}

/// The `values` array of a paginated response (missing = malformed, never empty).
pub fn page_values(page: &Value) -> Result<&Vec<Value>, BitbucketError> {
    page.get("values")
        .and_then(Value::as_array)
        .ok_or(BitbucketError::Malformed)
}

pub trait BitbucketCredentialProvider: Send + Sync {
    /// Value for the `Authorization` header, or `None` when not configured.
    fn authorization(&self) -> Result<Option<String>, SecretError>;
}

/// Atlassian API token (or legacy app password) sent as HTTP Basic with the
/// account email (or username). Both parts live in the keychain.
pub struct ApiTokenProvider {
    store: Arc<dyn SecretStore>,
    email_account: String,
    token_account: String,
}

impl ApiTokenProvider {
    pub fn new(
        store: Arc<dyn SecretStore>,
        email_account: impl Into<String>,
        token_account: impl Into<String>,
    ) -> Self {
        Self {
            store,
            email_account: email_account.into(),
            token_account: token_account.into(),
        }
    }
}

pub fn basic_authorization(email: &str, token: &str) -> String {
    let raw = format!("{email}:{token}");
    format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(raw)
    )
}

impl BitbucketCredentialProvider for ApiTokenProvider {
    fn authorization(&self) -> Result<Option<String>, SecretError> {
        let Some(token) = self.store.get(&self.token_account)? else {
            return Ok(None);
        };
        let Some(email) = self.store.get(&self.email_account)? else {
            return Ok(None);
        };
        Ok(Some(basic_authorization(&email, &token)))
    }
}

#[derive(Clone)]
pub struct BitbucketClient {
    http: reqwest::Client,
}

impl BitbucketClient {
    pub fn new() -> Result<Self, BitbucketError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            // The PR diff/diffstat endpoints answer with a same-host redirect.
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5
                    || !attempt.url().as_str().starts_with(&format!("{API_ROOT}/"))
                {
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            }))
            .build()
            .map_err(|_| BitbucketError::Network)?;
        Ok(Self { http })
    }

    async fn send(
        &self,
        authorization: &str,
        target: &str,
    ) -> Result<reqwest::Response, BitbucketError> {
        let url = resolve_url(target)?;
        let resp = self
            .http
            .get(url)
            .header("Authorization", authorization)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|_| BitbucketError::Network)?;
        match interpret_status(resp.status().as_u16()) {
            Some(err) => Err(err),
            None => Ok(resp),
        }
    }

    /// GET an API path or validated `next` link and parse its JSON body.
    pub async fn get_json(
        &self,
        authorization: &str,
        target: &str,
    ) -> Result<Value, BitbucketError> {
        let text = self
            .send(authorization, target)
            .await?
            .text()
            .await
            .map_err(|_| BitbucketError::Network)?;
        serde_json::from_str(&text).map_err(|_| BitbucketError::Malformed)
    }

    /// GET a text body, reading at most `max_bytes`. Returns the (lossy UTF-8)
    /// text and whether it was cut off.
    pub async fn get_text(
        &self,
        authorization: &str,
        target: &str,
        max_bytes: usize,
    ) -> Result<(String, bool), BitbucketError> {
        let mut resp = self.send(authorization, target).await?;
        let mut body: Vec<u8> = Vec::new();
        let mut truncated = false;
        while let Some(chunk) = resp.chunk().await.map_err(|_| BitbucketError::Network)? {
            let room = max_bytes - body.len();
            if chunk.len() > room {
                body.extend_from_slice(&chunk[..room]);
                truncated = true;
                break;
            }
            body.extend_from_slice(&chunk);
        }
        Ok((String::from_utf8_lossy(&body).into_owned(), truncated))
    }
}

/// Everything the Bitbucket commands need, held as one `AppState` field.
pub struct BitbucketState {
    pub credentials: Arc<dyn BitbucketCredentialProvider>,
    pub client: BitbucketClient,
    /// Serializes credential mutations and sync (set/clear/test/sync).
    pub lock: tokio::sync::Mutex<()>,
    /// Bumped by every Bitbucket cache wipe or module disable; guards late writes.
    pub generation: AtomicU64,
}

impl BitbucketState {
    pub fn new(credentials: Arc<dyn BitbucketCredentialProvider>, client: BitbucketClient) -> Self {
        Self {
            credentials,
            client,
            lock: tokio::sync::Mutex::new(()),
            generation: AtomicU64::new(0),
        }
    }
}

/// Shared JSON helpers for the parsers.
pub(crate) fn str_at(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_owned)
}

/// The user-facing handle of an account object: nickname, else display name.
pub(crate) fn account_login(account: Option<&Value>) -> Option<String> {
    let a = account?;
    str_at(a, "nickname").or_else(|| str_at(a, "display_name"))
}

pub(crate) fn account_avatar(account: Option<&Value>) -> Option<String> {
    account?
        .get("links")
        .and_then(|l| l.get("avatar"))
        .and_then(|a| str_at(a, "href"))
}

#[cfg(test)]
pub mod fake {
    use super::*;

    /// A credential provider that returns a fixed authorization value.
    pub struct FakeBitbucketCreds(pub Option<String>);

    impl BitbucketCredentialProvider for FakeBitbucketCreds {
        fn authorization(&self) -> Result<Option<String>, SecretError> {
            Ok(self.0.clone())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::fake::FakeSecretStore;
    use serde_json::json;

    #[test]
    fn statuses_map_to_sanitized_errors() {
        assert!(interpret_status(200).is_none());
        assert!(interpret_status(204).is_none());
        assert!(matches!(interpret_status(401), Some(BitbucketError::Auth)));
        assert!(matches!(interpret_status(403), Some(BitbucketError::Auth)));
        assert!(matches!(
            interpret_status(429),
            Some(BitbucketError::RateLimited)
        ));
        assert!(matches!(
            interpret_status(502),
            Some(BitbucketError::Server)
        ));
        assert!(matches!(interpret_status(404), Some(BitbucketError::Api)));
    }

    #[test]
    fn urls_stay_on_the_api_host() {
        assert_eq!(
            resolve_url("/user").unwrap(),
            "https://api.bitbucket.org/2.0/user"
        );
        assert!(resolve_url("https://api.bitbucket.org/2.0/user?page=2").is_ok());
        for bad in [
            "https://evil.example/2.0/user",
            "https://api.bitbucket.org.evil.example/2.0/x",
            "https://api.bitbucket.org/2.0@evil.example/x",
            "http://api.bitbucket.org/2.0/user",
            "//evil.example/x",
            "user",
        ] {
            assert!(resolve_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn next_link_is_validated_and_optional() {
        assert_eq!(next_link(&json!({ "values": [] })).unwrap(), None);
        assert_eq!(
            next_link(&json!({ "next": "https://api.bitbucket.org/2.0/x?page=2" }))
                .unwrap()
                .as_deref(),
            Some("https://api.bitbucket.org/2.0/x?page=2")
        );
        assert!(next_link(&json!({ "next": "https://evil.example/x" })).is_err());
        assert!(page_values(&json!({})).is_err());
    }

    #[test]
    fn api_token_provider_needs_both_parts_and_sends_basic_auth() {
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let provider = ApiTokenProvider::new(store.clone(), "bitbucket_email", "bitbucket_token");
        assert_eq!(provider.authorization().unwrap(), None);
        store.set("bitbucket_token", "tok").unwrap();
        assert_eq!(provider.authorization().unwrap(), None);
        store.set("bitbucket_email", "me@example.com").unwrap();
        // base64("me@example.com:tok")
        assert_eq!(
            provider.authorization().unwrap().as_deref(),
            Some("Basic bWVAZXhhbXBsZS5jb206dG9r")
        );
    }

    #[test]
    fn account_helpers_prefer_nickname() {
        let a = json!({ "nickname": "abrar", "display_name": "Abrar E", "links": { "avatar": { "href": "https://a/x.png" } } });
        assert_eq!(account_login(Some(&a)).as_deref(), Some("abrar"));
        assert_eq!(account_avatar(Some(&a)).as_deref(), Some("https://a/x.png"));
        let b = json!({ "display_name": "Abrar E" });
        assert_eq!(account_login(Some(&b)).as_deref(), Some("Abrar E"));
        assert_eq!(account_login(None), None);
    }
}
