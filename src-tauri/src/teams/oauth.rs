//! Microsoft identity platform (v2) device-code flow: pure parsing and input
//! validation. The HTTP calls live in `GraphClient`; nothing here does I/O.

use serde_json::Value;

use super::TeamsError;

/// Delegated scopes requested at sign-in. All are user-consentable.
pub const SCOPES: &str = "offline_access User.Read Chat.Read";
pub const DEFAULT_TENANT: &str = "organizations";

/// What the user needs to finish signing in, plus the secret `device_code`
/// that only Rust keeps.
#[derive(Debug, Clone, PartialEq)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: i64,
    pub interval: i64,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

/// Outcome of one poll of the token endpoint.
#[derive(Debug, Clone, PartialEq)]
pub enum TokenPoll {
    Granted(TokenSet),
    Pending,
    SlowDown,
    Declined,
    Expired,
    /// Any other `error` (bad_verification_code, invalid_grant, ...).
    Failed,
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(str::to_string)
}

pub fn parse_device_code(body: &str) -> Result<DeviceCode, TeamsError> {
    let v: Value = serde_json::from_str(body).map_err(|_| TeamsError::Malformed)?;
    if v.get("error").is_some() {
        return Err(TeamsError::Auth);
    }
    Ok(DeviceCode {
        device_code: str_field(&v, "device_code").ok_or(TeamsError::Malformed)?,
        user_code: str_field(&v, "user_code").ok_or(TeamsError::Malformed)?,
        verification_uri: str_field(&v, "verification_uri").ok_or(TeamsError::Malformed)?,
        expires_in: v.get("expires_in").and_then(|n| n.as_i64()).unwrap_or(900),
        interval: v
            .get("interval")
            .and_then(|n| n.as_i64())
            .unwrap_or(5)
            .max(1),
        message: str_field(&v, "message"),
    })
}

/// Interpret a token-endpoint body (device-code poll or refresh). Error bodies
/// arrive with HTTP 400, so the status is not consulted here.
pub fn parse_token_response(body: &str) -> Result<TokenPoll, TeamsError> {
    let v: Value = serde_json::from_str(body).map_err(|_| TeamsError::Malformed)?;
    if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
        return Ok(match err {
            "authorization_pending" => TokenPoll::Pending,
            "slow_down" => TokenPoll::SlowDown,
            "authorization_declined" | "access_denied" => TokenPoll::Declined,
            "expired_token" => TokenPoll::Expired,
            _ => TokenPoll::Failed,
        });
    }
    let access_token = str_field(&v, "access_token").ok_or(TeamsError::Malformed)?;
    Ok(TokenPoll::Granted(TokenSet {
        access_token,
        refresh_token: str_field(&v, "refresh_token").filter(|t| !t.is_empty()),
    }))
}

/// A refresh exchange either yields tokens or means the stored grant is dead.
pub fn refresh_result(poll: TokenPoll) -> Result<TokenSet, TeamsError> {
    match poll {
        TokenPoll::Granted(t) => Ok(t),
        _ => Err(TeamsError::Auth),
    }
}

/// Application (client) IDs are GUIDs.
pub fn valid_client_id(s: &str) -> bool {
    is_guid(s)
}

fn is_guid(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    let lens = [8, 4, 4, 4, 12];
    parts.len() == 5
        && parts
            .iter()
            .zip(lens)
            .all(|(p, n)| p.len() == n && p.chars().all(|c| c.is_ascii_hexdigit()))
}

/// Tenant path segment: an alias, a GUID, or a domain name. Anything else is
/// rejected so user input is never spliced unchecked into the login URL.
pub fn normalize_tenant(raw: Option<&str>) -> Option<String> {
    let t = raw.map(str::trim).filter(|t| !t.is_empty());
    let t = match t {
        None => return Some(DEFAULT_TENANT.to_string()),
        Some(t) => t,
    };
    let alias = matches!(t, "organizations" | "common");
    let domain = t.contains('.')
        && !t.starts_with('.')
        && !t.ends_with('.')
        && !t.contains("..")
        && t.len() <= 253
        && t.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    (alias || is_guid(t) || domain).then(|| t.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_device_code_response() {
        let d = parse_device_code(
            r#"{"device_code":"GMMhmHCXhWEzkobqIHGG_EnNYYsAkukHspeYUk9E8","user_code":"ABCD1234",
               "verification_uri":"https://microsoft.com/devicelogin","expires_in":900,"interval":5,
               "message":"To sign in, use a web browser..."}"#,
        )
        .unwrap();
        assert_eq!(d.user_code, "ABCD1234");
        assert_eq!(d.verification_uri, "https://microsoft.com/devicelogin");
        assert_eq!((d.expires_in, d.interval), (900, 5));
    }

    #[test]
    fn device_code_error_is_auth() {
        assert!(matches!(
            parse_device_code(r#"{"error":"invalid_client","error_description":"x"}"#),
            Err(TeamsError::Auth)
        ));
        assert!(matches!(
            parse_device_code("{}"),
            Err(TeamsError::Malformed)
        ));
    }

    #[test]
    fn poll_outcomes() {
        let p = |e: &str| parse_token_response(&format!(r#"{{"error":"{e}"}}"#)).unwrap();
        assert_eq!(p("authorization_pending"), TokenPoll::Pending);
        assert_eq!(p("slow_down"), TokenPoll::SlowDown);
        assert_eq!(p("authorization_declined"), TokenPoll::Declined);
        assert_eq!(p("expired_token"), TokenPoll::Expired);
        assert_eq!(p("bad_verification_code"), TokenPoll::Failed);
    }

    #[test]
    fn granted_carries_tokens() {
        let r = parse_token_response(
            r#"{"token_type":"Bearer","scope":"User.Read Chat.Read","expires_in":3599,
               "access_token":"at","refresh_token":"rt"}"#,
        )
        .unwrap();
        assert_eq!(
            r,
            TokenPoll::Granted(TokenSet {
                access_token: "at".into(),
                refresh_token: Some("rt".into())
            })
        );
        assert!(matches!(
            refresh_result(TokenPoll::Failed),
            Err(TeamsError::Auth)
        ));
    }

    #[test]
    fn validates_client_id_and_tenant() {
        assert!(valid_client_id("00001111-aaaa-2222-bbbb-3333cccc4444"));
        assert!(!valid_client_id("not-a-guid"));
        assert!(!valid_client_id("00001111-aaaa-2222-bbbb-3333cccc444g"));
        assert_eq!(normalize_tenant(None).as_deref(), Some("organizations"));
        assert_eq!(
            normalize_tenant(Some("  ")).as_deref(),
            Some("organizations")
        );
        assert_eq!(normalize_tenant(Some("common")).as_deref(), Some("common"));
        assert_eq!(
            normalize_tenant(Some("contoso.onmicrosoft.com")).as_deref(),
            Some("contoso.onmicrosoft.com")
        );
        assert!(normalize_tenant(Some("b33cbe9f-8ebe-4f2a-912b-7e2a427f477f")).is_some());
        for bad in ["../evil", "a/b", "evil.com/x", "x?y=1", "consumers", "a..b"] {
            assert_eq!(normalize_tenant(Some(bad)), None, "{bad}");
        }
    }
}
