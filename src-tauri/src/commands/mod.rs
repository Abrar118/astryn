use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ConnectionStatus {
    NotConfigured,
    Unverified,
    Connected { name: String },
}

pub fn compute_status(has_key: bool, cached_name: Option<String>) -> ConnectionStatus {
    match (has_key, cached_name) {
        (false, _) => ConnectionStatus::NotConfigured,
        (true, Some(name)) => ConnectionStatus::Connected { name },
        (true, None) => ConnectionStatus::Unverified,
    }
}

#[cfg(test)]
mod status_tests {
    use super::*;

    #[test]
    fn no_key_is_not_configured() {
        assert_eq!(compute_status(false, None), ConnectionStatus::NotConfigured);
        assert_eq!(compute_status(false, Some("x".into())), ConnectionStatus::NotConfigured);
    }

    #[test]
    fn key_without_cache_is_unverified() {
        assert_eq!(compute_status(true, None), ConnectionStatus::Unverified);
    }

    #[test]
    fn key_with_cache_is_connected() {
        assert_eq!(
            compute_status(true, Some("Abrar".into())),
            ConnectionStatus::Connected { name: "Abrar".into() }
        );
    }

    #[test]
    fn connected_serializes_with_state_and_name() {
        let json = serde_json::to_string(&ConnectionStatus::Connected { name: "Abrar".into() }).unwrap();
        assert_eq!(json, r#"{"state":"connected","name":"Abrar"}"#);
    }

    #[test]
    fn not_configured_serializes_with_state_only() {
        let json = serde_json::to_string(&ConnectionStatus::NotConfigured).unwrap();
        assert_eq!(json, r#"{"state":"not_configured"}"#);
    }
}
