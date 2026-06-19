pub mod issues;
pub mod sync;

use serde::Deserialize;
use serde_json::Value;

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
}

/// Classify a non-empty GraphQL `errors` array. Linear may report throttling as
/// a GraphQL error with extension code RATELIMITED (even on HTTP 200/400).
#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
pub fn http_status_to_error(status: u16) -> Option<LinearError> {
    match status {
        401 | 403 => Some(LinearError::Auth),
        429 => Some(LinearError::RateLimited(None)), // http_post fills the reset hint from headers
        500..=599 => Some(LinearError::Server),
        _ => None,
    }
}

#[allow(dead_code)]
#[derive(Deserialize, Debug, PartialEq)]
pub struct Viewer {
    pub id: String,
    pub name: String,
    pub email: String,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct GraphQLResponse<T> {
    data: Option<T>,
    errors: Option<Vec<GraphQLError>>,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct GraphQLError {
    message: String,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct ViewerData {
    viewer: Viewer,
}

/// Parse a GraphQL response body. GraphQL surfaces errors with HTTP 200, so a
/// non-empty `errors` array is a failure even when the transport succeeded.
#[allow(dead_code)]
pub fn parse_viewer_response(body: &str) -> Result<Viewer, LinearError> {
    let resp: GraphQLResponse<ViewerData> =
        serde_json::from_str(body).map_err(|_| LinearError::Malformed)?;
    if let Some(errors) = resp.errors {
        if !errors.is_empty() {
            let joined = errors
                .into_iter()
                .map(|e| e.message)
                .collect::<Vec<_>>()
                .join("; ");
            return Err(LinearError::Api(joined));
        }
    }
    resp.data.map(|d| d.viewer).ok_or(LinearError::Malformed)
}

/// Map an HTTP status + body to a result. Distinguishes auth / rate-limit /
/// server failures from malformed GraphQL so they are never misclassified.
#[allow(dead_code)]
pub fn interpret_response(status: u16, body: &str) -> Result<Viewer, LinearError> {
    match status {
        401 | 403 => Err(LinearError::Auth),
        429 => Err(LinearError::RateLimited(None)),
        500..=599 => Err(LinearError::Server),
        // 2xx (and any other status carrying a GraphQL body) go through the parser,
        // which handles HTTP-200-with-errors.
        _ => parse_viewer_response(body),
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
        Ok(Self {
            http,
            endpoint: endpoint.into(),
        })
    }

    /// POST a GraphQL body, returning the raw response text. Maps unambiguous
    /// transport statuses to errors; leaves body parsing to the caller's parser.
    #[allow(dead_code)]
    pub async fn http_post(
        &self,
        authorization: &str,
        body: serde_json::Value,
    ) -> Result<String, LinearError> {
        let resp = self
            .http
            .post(&self.endpoint)
            .header("Authorization", authorization)
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

    #[allow(dead_code)]
    pub async fn viewer(&self, authorization: &str) -> Result<Viewer, LinearError> {
        let body = serde_json::json!({ "query": "query { viewer { id name email } }" });
        let resp = self
            .http
            .post(&self.endpoint)
            .header("Authorization", authorization)
            .json(&body)
            .send()
            .await
            .map_err(|_| LinearError::Network)?;
        let status = resp.status().as_u16();
        let text = resp.text().await.map_err(|_| LinearError::Network)?;
        interpret_response(status, &text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OK_BODY: &str = r#"{"data":{"viewer":{"id":"u1","name":"Abrar","email":"a@b.c"}}}"#;

    #[test]
    fn parses_valid_viewer() {
        let v = parse_viewer_response(OK_BODY).unwrap();
        assert_eq!(
            v,
            Viewer {
                id: "u1".into(),
                name: "Abrar".into(),
                email: "a@b.c".into()
            }
        );
    }

    #[test]
    fn success_status_parses_viewer() {
        assert_eq!(interpret_response(200, OK_BODY).unwrap().name, "Abrar");
    }

    #[test]
    fn graphql_errors_are_failures_even_on_http_200() {
        let body = r#"{"data":null,"errors":[{"message":"Authentication required"}]}"#;
        match interpret_response(200, body) {
            Err(LinearError::Api(msg)) => assert!(msg.contains("Authentication required")),
            other => panic!("expected Api error, got {other:?}"),
        }
    }

    #[test]
    fn unauthorized_is_auth_error() {
        assert!(matches!(
            interpret_response(401, "{}"),
            Err(LinearError::Auth)
        ));
    }

    #[test]
    fn too_many_requests_is_rate_limited() {
        assert!(matches!(
            interpret_response(429, ""),
            Err(LinearError::RateLimited(_))
        ));
    }

    #[test]
    fn server_error_is_server() {
        assert!(matches!(
            interpret_response(500, ""),
            Err(LinearError::Server)
        ));
    }

    #[test]
    fn malformed_200_body_is_error() {
        assert!(matches!(
            interpret_response(200, "not json"),
            Err(LinearError::Malformed)
        ));
    }

    #[test]
    fn missing_data_without_errors_is_malformed() {
        assert!(matches!(
            parse_viewer_response("{}"),
            Err(LinearError::Malformed)
        ));
    }
}
