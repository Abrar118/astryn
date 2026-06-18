use serde::Deserialize;

#[derive(Debug, thiserror::Error)]
pub enum LinearError {
    #[error("network error")]
    Network,
    #[error("malformed response")]
    Malformed,
    #[error("authentication failed")]
    Auth,
    #[error("rate limited")]
    RateLimited,
    #[error("server error")]
    Server,
    #[error("api error: {0}")]
    Api(String),
}

#[derive(Deserialize, Debug, PartialEq)]
pub struct Viewer {
    pub id: String,
    pub name: String,
    pub email: String,
}

#[derive(Deserialize)]
struct GraphQLResponse<T> {
    data: Option<T>,
    errors: Option<Vec<GraphQLError>>,
}

#[derive(Deserialize)]
struct GraphQLError {
    message: String,
}

#[derive(Deserialize)]
struct ViewerData {
    viewer: Viewer,
}

/// Parse a GraphQL response body. GraphQL surfaces errors with HTTP 200, so a
/// non-empty `errors` array is a failure even when the transport succeeded.
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
pub fn interpret_response(status: u16, body: &str) -> Result<Viewer, LinearError> {
    match status {
        401 | 403 => Err(LinearError::Auth),
        429 => Err(LinearError::RateLimited),
        500..=599 => Err(LinearError::Server),
        // 2xx (and any other status carrying a GraphQL body) go through the parser,
        // which handles HTTP-200-with-errors.
        _ => parse_viewer_response(body),
    }
}

use std::sync::Arc;
use std::time::Duration;
use crate::secrets::{SecretError, SecretStore};

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
        Self { store, account: account.into() }
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
        Ok(Self { http, endpoint: endpoint.into() })
    }

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
        assert_eq!(v, Viewer { id: "u1".into(), name: "Abrar".into(), email: "a@b.c".into() });
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
        assert!(matches!(interpret_response(401, "{}"), Err(LinearError::Auth)));
    }

    #[test]
    fn too_many_requests_is_rate_limited() {
        assert!(matches!(interpret_response(429, ""), Err(LinearError::RateLimited)));
    }

    #[test]
    fn server_error_is_server() {
        assert!(matches!(interpret_response(500, ""), Err(LinearError::Server)));
    }

    #[test]
    fn malformed_200_body_is_error() {
        assert!(matches!(interpret_response(200, "not json"), Err(LinearError::Malformed)));
    }

    #[test]
    fn missing_data_without_errors_is_malformed() {
        assert!(matches!(parse_viewer_response("{}"), Err(LinearError::Malformed)));
    }
}
