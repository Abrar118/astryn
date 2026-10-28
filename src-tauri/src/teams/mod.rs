//! Microsoft Teams chat provider: Microsoft Graph client, the device-code
//! OAuth seam, and the keychain-backed credential provider.

pub mod catchup;
pub mod oauth;

use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

use crate::secrets::{SecretError, SecretStore};
use oauth::{DeviceCode, TokenPoll, TokenSet};

#[derive(Debug, thiserror::Error)]
pub enum TeamsError {
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

/// Map a Graph HTTP status to an error. 401/403 mean the token or consent is
/// missing; 429 carries the `Retry-After` delta in seconds.
pub fn interpret_graph_status(status: u16, retry_after: Option<i64>) -> Option<TeamsError> {
    match status {
        200..=299 => None,
        401 | 403 => Some(TeamsError::Auth),
        429 => Some(TeamsError::RateLimited(retry_after)),
        500..=599 => Some(TeamsError::Server),
        other => Some(TeamsError::Api(other.to_string())),
    }
}

/// The refresh token is the only stored Teams secret. Windows Credential
/// Manager caps a password at 1,280 UTF-16 chars and Entra refresh tokens can
/// be longer, so it is split across numbered accounts.
pub const REFRESH_TOKEN_ACCOUNT: &str = "teams_refresh_token";
const CHUNK_CHARS: usize = 1000;
const MAX_CHUNKS: usize = 8;

fn chunk_account(i: usize) -> String {
    format!("{REFRESH_TOKEN_ACCOUNT}.{i}")
}

pub fn save_refresh_token(store: &dyn SecretStore, token: &str) -> Result<(), SecretError> {
    let chars: Vec<char> = token.chars().collect();
    let chunks: Vec<String> = chars
        .chunks(CHUNK_CHARS)
        .map(|c| c.iter().collect())
        .collect();
    if chunks.is_empty() || chunks.len() > MAX_CHUNKS {
        return Err(SecretError::Backend);
    }
    for (i, c) in chunks.iter().enumerate() {
        store.set(&chunk_account(i), c)?;
    }
    for i in chunks.len()..MAX_CHUNKS {
        store.delete(&chunk_account(i))?;
    }
    Ok(())
}

pub fn load_refresh_token(store: &dyn SecretStore) -> Result<Option<String>, SecretError> {
    let mut out = String::new();
    for i in 0..MAX_CHUNKS {
        match store.get(&chunk_account(i))? {
            Some(c) => out.push_str(&c),
            None => break,
        }
    }
    Ok((!out.is_empty()).then_some(out))
}

pub fn clear_refresh_token(store: &dyn SecretStore) -> Result<(), SecretError> {
    for i in 0..MAX_CHUNKS {
        store.delete(&chunk_account(i))?;
    }
    Ok(())
}

/// Auth seam (mirrors `SlackCredentialProvider`): where the long-lived grant
/// lives. Blocking (keychain); call it off the async executor.
pub trait TeamsCredentialProvider: Send + Sync {
    fn refresh_token(&self) -> Result<Option<String>, SecretError>;
    fn save_refresh_token(&self, token: &str) -> Result<(), SecretError>;
    fn clear(&self) -> Result<(), SecretError>;
}

pub struct KeychainTokenProvider {
    store: Arc<dyn SecretStore>,
}

impl KeychainTokenProvider {
    pub fn new(store: Arc<dyn SecretStore>) -> Self {
        Self { store }
    }
}

impl TeamsCredentialProvider for KeychainTokenProvider {
    fn refresh_token(&self) -> Result<Option<String>, SecretError> {
        load_refresh_token(self.store.as_ref())
    }
    fn save_refresh_token(&self, token: &str) -> Result<(), SecretError> {
        save_refresh_token(self.store.as_ref(), token)
    }
    fn clear(&self) -> Result<(), SecretError> {
        clear_refresh_token(self.store.as_ref())
    }
}

/// True when `url` stays on the Graph origin, so a paging link can never carry
/// the bearer token to another host.
pub fn same_origin(url: &str, base: &str) -> bool {
    let origin = |u: &str| {
        reqwest::Url::parse(u).ok().map(|p| {
            (
                p.scheme().to_string(),
                p.host_str().map(str::to_string),
                p.port_or_known_default(),
            )
        })
    };
    match (origin(url), origin(base)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

#[derive(Clone)]
pub struct GraphClient {
    http: reqwest::Client,
    graph_base: String,
    login_base: String,
}

impl GraphClient {
    pub fn new() -> Result<Self, TeamsError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| TeamsError::Network)?;
        Ok(Self {
            http,
            graph_base: "https://graph.microsoft.com/v1.0".into(),
            login_base: "https://login.microsoftonline.com".into(),
        })
    }

    /// `{graph_base}/{segments...}?{query}`. Segments are percent-encoded; the
    /// query is a fixed OData string (`$` kept literal, spaces as `%20`).
    pub fn graph_url(&self, segments: &[&str], query: &str) -> String {
        let mut url = reqwest::Url::parse(&self.graph_base).expect("valid graph base");
        url.path_segments_mut()
            .expect("graph base has a path")
            .extend(segments);
        if !query.is_empty() {
            url.set_query(Some(query));
        }
        url.to_string()
    }

    pub fn is_graph_url(&self, url: &str) -> bool {
        same_origin(url, &self.graph_base)
    }

    /// GET a Graph URL with a bearer token. Refuses URLs off the Graph origin.
    pub async fn get(&self, access_token: &str, url: &str) -> Result<Value, TeamsError> {
        if !self.is_graph_url(url) {
            return Err(TeamsError::Malformed);
        }
        let resp = self
            .http
            .get(url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| TeamsError::Network)?;
        let status = resp.status().as_u16();
        let retry_after = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<i64>().ok());
        if let Some(e) = interpret_graph_status(status, retry_after) {
            return Err(e);
        }
        let text = resp.text().await.map_err(|_| TeamsError::Network)?;
        serde_json::from_str(&text).map_err(|_| TeamsError::Malformed)
    }

    async fn post_identity(
        &self,
        tenant: &str,
        endpoint: &str,
        form: &[(&str, &str)],
    ) -> Result<String, TeamsError> {
        let url = format!("{}/{}/oauth2/v2.0/{}", self.login_base, tenant, endpoint);
        let resp = self
            .http
            .post(&url)
            .form(form)
            .send()
            .await
            .map_err(|_| TeamsError::Network)?;
        let status = resp.status().as_u16();
        // Token errors (authorization_pending, invalid_grant, ...) come as 400
        // with a JSON body; only transport-level statuses short-circuit here.
        match status {
            429 => return Err(TeamsError::RateLimited(None)),
            500..=599 => return Err(TeamsError::Server),
            _ => {}
        }
        resp.text().await.map_err(|_| TeamsError::Network)
    }

    pub async fn request_device_code(
        &self,
        tenant: &str,
        client_id: &str,
    ) -> Result<DeviceCode, TeamsError> {
        let body = self
            .post_identity(
                tenant,
                "devicecode",
                &[("client_id", client_id), ("scope", oauth::SCOPES)],
            )
            .await?;
        oauth::parse_device_code(&body)
    }

    pub async fn poll_device_token(
        &self,
        tenant: &str,
        client_id: &str,
        device_code: &str,
    ) -> Result<TokenPoll, TeamsError> {
        let body = self
            .post_identity(
                tenant,
                "token",
                &[
                    ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                    ("client_id", client_id),
                    ("device_code", device_code),
                ],
            )
            .await?;
        oauth::parse_token_response(&body)
    }

    pub async fn refresh(
        &self,
        tenant: &str,
        client_id: &str,
        refresh_token: &str,
    ) -> Result<TokenSet, TeamsError> {
        let body = self
            .post_identity(
                tenant,
                "token",
                &[
                    ("grant_type", "refresh_token"),
                    ("client_id", client_id),
                    ("refresh_token", refresh_token),
                    ("scope", oauth::SCOPES),
                ],
            )
            .await?;
        oauth::refresh_result(oauth::parse_token_response(&body)?)
    }
}

#[cfg(test)]
pub mod fake {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct FakeTeamsCreds(pub Mutex<Option<String>>);

    impl FakeTeamsCreds {
        pub fn with(token: &str) -> Self {
            Self(Mutex::new(Some(token.into())))
        }
    }

    impl TeamsCredentialProvider for FakeTeamsCreds {
        fn refresh_token(&self) -> Result<Option<String>, SecretError> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn save_refresh_token(&self, token: &str) -> Result<(), SecretError> {
            *self.0.lock().unwrap() = Some(token.into());
            Ok(())
        }
        fn clear(&self) -> Result<(), SecretError> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::fake::FakeSecretStore;

    #[test]
    fn graph_status_mapping() {
        assert!(interpret_graph_status(200, None).is_none());
        assert!(matches!(
            interpret_graph_status(401, None),
            Some(TeamsError::Auth)
        ));
        assert!(matches!(
            interpret_graph_status(403, None),
            Some(TeamsError::Auth)
        ));
        assert!(matches!(
            interpret_graph_status(429, Some(7)),
            Some(TeamsError::RateLimited(Some(7)))
        ));
        assert!(matches!(
            interpret_graph_status(503, None),
            Some(TeamsError::Server)
        ));
        assert!(matches!(
            interpret_graph_status(404, None),
            Some(TeamsError::Api(_))
        ));
    }

    #[test]
    fn refresh_token_round_trips_in_chunks() {
        let store = FakeSecretStore::default();
        let long: String = "r".repeat(2500);
        save_refresh_token(&store, &long).unwrap();
        // Three chunks, each within the Windows Credential Manager limit.
        for i in 0..3 {
            let c = store.get(&chunk_account(i)).unwrap().unwrap();
            assert!(c.encode_utf16().count() * 2 <= 2560);
        }
        assert_eq!(store.get(&chunk_account(3)).unwrap(), None);
        assert_eq!(
            load_refresh_token(&store).unwrap().as_deref(),
            Some(long.as_str())
        );
    }

    #[test]
    fn shorter_token_drops_stale_chunks() {
        let store = FakeSecretStore::default();
        save_refresh_token(&store, &"a".repeat(2500)).unwrap();
        save_refresh_token(&store, "short").unwrap();
        assert_eq!(store.get(&chunk_account(1)).unwrap(), None);
        assert_eq!(
            load_refresh_token(&store).unwrap().as_deref(),
            Some("short")
        );
    }

    #[test]
    fn clear_and_absent_token() {
        let store = FakeSecretStore::default();
        assert_eq!(load_refresh_token(&store).unwrap(), None);
        save_refresh_token(&store, "x").unwrap();
        clear_refresh_token(&store).unwrap();
        assert_eq!(load_refresh_token(&store).unwrap(), None);
        assert!(save_refresh_token(&store, "").is_err());
        assert!(save_refresh_token(&store, &"z".repeat(8001)).is_err());
    }

    #[test]
    fn keychain_provider_uses_the_store() {
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let p = KeychainTokenProvider::new(store.clone());
        p.save_refresh_token("rt-1").unwrap();
        assert_eq!(
            store.get("teams_refresh_token.0").unwrap().as_deref(),
            Some("rt-1")
        );
        assert_eq!(p.refresh_token().unwrap().as_deref(), Some("rt-1"));
        p.clear().unwrap();
        assert_eq!(p.refresh_token().unwrap(), None);
    }

    #[test]
    fn next_links_must_stay_on_graph() {
        let c = GraphClient::new().unwrap();
        assert!(c.is_graph_url("https://graph.microsoft.com/v1.0/me/chats?$skiptoken=abc"));
        assert!(!c.is_graph_url("https://evil.example/v1.0/me/chats"));
        assert!(!c.is_graph_url("http://graph.microsoft.com/v1.0/me"));
        assert!(!c.is_graph_url("https://graph.microsoft.com.evil.example/x"));
        assert!(!c.is_graph_url("not a url"));
    }

    #[test]
    fn graph_url_encodes_segments_and_query() {
        let c = GraphClient::new().unwrap();
        let u = c.graph_url(
            &["chats", "19:abc@thread.v2", "messages"],
            "$top=50&$orderby=createdDateTime%20desc",
        );
        assert_eq!(
            u,
            "https://graph.microsoft.com/v1.0/chats/19:abc@thread.v2/messages?$top=50&$orderby=createdDateTime%20desc"
        );
        // A hostile id cannot add path segments or a query.
        let u = c.graph_url(&["chats", "a/b?x=1"], "");
        assert_eq!(u, "https://graph.microsoft.com/v1.0/chats/a%2Fb%3Fx=1");
    }
}
