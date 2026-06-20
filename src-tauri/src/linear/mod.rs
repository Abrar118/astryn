pub mod issues;
pub mod sync;

use base64::Engine;
use serde_json::Value;

pub const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum LinearError {
    #[error("network error")]
    Network,
    #[error("malformed response")]
    Malformed,
    #[error("authentication failed")]
    Auth,
    #[error("rate limited")]
    RateLimited(Option<i64>),
    #[error("server error")]
    Server,
    #[error("api error: {0}")]
    Api(String),
    #[error("asset unavailable")]
    Asset,
}

pub fn validate_linear_upload_url(value: &str) -> Result<reqwest::Url, LinearError> {
    let url = reqwest::Url::parse(value).map_err(|_| LinearError::Asset)?;
    if url.scheme() != "https"
        || url.host_str() != Some("uploads.linear.app")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(LinearError::Asset);
    }
    Ok(url)
}

pub fn image_data_url(content_type: &str, bytes: &[u8]) -> Result<String, LinearError> {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if bytes.len() > MAX_IMAGE_BYTES
        || !matches!(
            mime.as_str(),
            "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif"
        )
    {
        return Err(LinearError::Asset);
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

/// Classify a non-empty GraphQL `errors` array. Linear may report throttling as
/// a GraphQL error with extension code RATELIMITED (even on HTTP 200/400).
pub fn classify_graphql_errors(errors: &[Value]) -> LinearError {
    let is_ratelimited = errors.iter().any(|e| {
        e.get("extensions")
            .and_then(|x| x.get("code"))
            .and_then(|c| c.as_str())
            == Some("RATELIMITED")
            || e.get("extensions")
                .and_then(|x| x.get("type"))
                .and_then(|c| c.as_str())
                == Some("RATELIMITED")
    });
    if is_ratelimited {
        return LinearError::RateLimited(None);
    }
    let joined = errors
        .iter()
        .filter_map(|e| e.get("message").and_then(|m| m.as_str()))
        .collect::<Vec<_>>()
        .join("; ");
    LinearError::Api(joined)
}

/// Parse a GraphQL body to its `data` object, treating a non-empty `errors`
/// array as a failure (HTTP-200-with-errors), RATELIMITED-aware.
pub fn extract_data(body: &str) -> Result<Value, LinearError> {
    let v: Value = serde_json::from_str(body).map_err(|_| LinearError::Malformed)?;
    if let Some(errors) = v.get("errors").and_then(|e| e.as_array()) {
        if !errors.is_empty() {
            return Err(classify_graphql_errors(errors));
        }
    }
    v.get("data").cloned().ok_or(LinearError::Malformed)
}

/// Map only the unambiguous transport statuses to errors; 2xx and 400 fall
/// through to body parsing (where GraphQL errors incl. RATELIMITED are detected).
pub fn http_status_to_error(status: u16) -> Option<LinearError> {
    match status {
        401 | 403 => Some(LinearError::Auth),
        429 => Some(LinearError::RateLimited(None)), // http_post fills the reset hint from headers
        500..=599 => Some(LinearError::Server),
        _ => None,
    }
}

use crate::secrets::{SecretError, SecretStore};
use std::sync::Arc;
use std::time::Duration;

pub trait LinearCredentialProvider: Send + Sync {
    /// Returns the value for the `Authorization` header, or `None` if no key is stored.
    fn authorization(&self) -> Result<Option<String>, SecretError>;
}

pub struct PersonalKeyProvider {
    store: Arc<dyn SecretStore>,
    account: String,
}

impl PersonalKeyProvider {
    pub fn new(store: Arc<dyn SecretStore>, account: impl Into<String>) -> Self {
        Self {
            store,
            account: account.into(),
        }
    }
}

impl LinearCredentialProvider for PersonalKeyProvider {
    fn authorization(&self) -> Result<Option<String>, SecretError> {
        // Linear personal API keys are sent raw, with no "Bearer " prefix.
        self.store.get(&self.account)
    }
}

#[derive(Clone)]
pub struct LinearClient {
    http: reqwest::Client,
    assets: reqwest::Client,
    endpoint: String,
}

impl LinearClient {
    pub fn new() -> Result<Self, LinearError> {
        Self::with_endpoint("https://api.linear.app/graphql")
    }

    /// Injectable endpoint — lets future integration tests point at a mock server.
    pub fn with_endpoint(endpoint: impl Into<String>) -> Result<Self, LinearError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| LinearError::Network)?;
        let assets = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| LinearError::Network)?;
        Ok(Self {
            http,
            assets,
            endpoint: endpoint.into(),
        })
    }

    /// POST a GraphQL body, returning the raw response text. Maps unambiguous
    /// transport statuses to errors; leaves body parsing to the caller's parser.
    pub async fn http_post(
        &self,
        authorization: &str,
        body: serde_json::Value,
    ) -> Result<String, LinearError> {
        let resp = self
            .http
            .post(&self.endpoint)
            .header("Authorization", authorization)
            .header("public-file-urls-expire-in", "300")
            .json(&body)
            .send()
            .await
            .map_err(|_| LinearError::Network)?;
        let status = resp.status().as_u16();
        // Capture the reset hint from headers before the body is consumed.
        if status == 429 {
            let h = resp.headers();
            let num = |name: &str| {
                h.get(name)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.parse::<i64>().ok())
            };
            // Retry-After is a delta (seconds); X-RateLimit-Requests-Reset is an epoch.
            let retry = num("retry-after").or_else(|| {
                num("x-ratelimit-requests-reset").map(|reset| {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    reset - now
                })
            });
            return Err(LinearError::RateLimited(retry));
        }
        let text = resp.text().await.map_err(|_| LinearError::Network)?;
        if let Some(e) = http_status_to_error(status) {
            return Err(e);
        }
        Ok(text)
    }

    pub async fn load_image(&self, value: &str) -> Result<String, LinearError> {
        let url = validate_linear_upload_url(value)?;
        let mut response = self
            .assets
            .get(url)
            .send()
            .await
            .map_err(|_| LinearError::Network)?;
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|len| len > MAX_IMAGE_BYTES as u64)
        {
            return Err(LinearError::Asset);
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .ok_or(LinearError::Asset)?
            .to_owned();
        let mut bytes = Vec::with_capacity(
            response
                .content_length()
                .unwrap_or_default()
                .min(MAX_IMAGE_BYTES as u64) as usize,
        );
        while let Some(chunk) = response.chunk().await.map_err(|_| LinearError::Network)? {
            if bytes.len() + chunk.len() > MAX_IMAGE_BYTES {
                return Err(LinearError::Asset);
            }
            bytes.extend_from_slice(&chunk);
        }
        image_data_url(&content_type, &bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_401_is_auth() {
        assert!(matches!(http_status_to_error(401), Some(LinearError::Auth)));
    }

    #[test]
    fn status_403_is_auth() {
        assert!(matches!(http_status_to_error(403), Some(LinearError::Auth)));
    }

    #[test]
    fn status_429_is_rate_limited() {
        assert!(matches!(
            http_status_to_error(429),
            Some(LinearError::RateLimited(_))
        ));
    }

    #[test]
    fn status_500_is_server() {
        assert!(matches!(
            http_status_to_error(500),
            Some(LinearError::Server)
        ));
    }

    #[test]
    fn status_200_is_none() {
        assert!(http_status_to_error(200).is_none());
    }

    #[test]
    fn status_400_is_none() {
        assert!(http_status_to_error(400).is_none());
    }

    #[test]
    fn linear_upload_urls_are_strictly_scoped() {
        assert!(
            validate_linear_upload_url("https://uploads.linear.app/asset/image?signature=abc")
                .is_ok()
        );
        assert!(validate_linear_upload_url("http://uploads.linear.app/asset").is_err());
        assert!(validate_linear_upload_url("https://uploads.linear.app.evil.test/asset").is_err());
        assert!(validate_linear_upload_url("https://user@uploads.linear.app/asset").is_err());
        assert!(validate_linear_upload_url("https://uploads.linear.app:444/asset").is_err());
    }

    #[test]
    fn image_data_urls_allow_bounded_raster_content_only() {
        assert_eq!(
            image_data_url("image/png", b"png").unwrap(),
            "data:image/png;base64,cG5n"
        );
        assert!(image_data_url("image/svg+xml", b"<svg/>").is_err());
        assert!(image_data_url("text/html", b"nope").is_err());
        assert!(image_data_url("image/png", &vec![0; MAX_IMAGE_BYTES + 1]).is_err());
    }
}
