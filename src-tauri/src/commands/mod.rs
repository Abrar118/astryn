use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::State;

use crate::db;
use crate::linear::{LinearClient, LinearCredentialProvider, LinearError, Viewer};
use crate::secrets::SecretStore;

const LINEAR_KEY_ACCOUNT: &str = "linear_api_key";

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

#[derive(Debug, thiserror::Error)]
pub enum CmdError {
    #[error("Could not access secure storage.")]
    SecretStore,
    #[error("No Linear key is configured.")]
    NotConfigured,
    #[error("Could not reach Linear.")]
    Network,
    #[error("Linear rate limit reached. Try again shortly.")]
    RateLimited,
    #[error("Linear rejected the request.")]
    LinearApi,
    #[error("Internal error.")]
    Internal,
}

impl serde::Serialize for CmdError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl From<LinearError> for CmdError {
    fn from(e: LinearError) -> Self {
        match e {
            LinearError::Network | LinearError::Server => CmdError::Network,
            LinearError::RateLimited => CmdError::RateLimited,
            LinearError::Auth | LinearError::Api(_) | LinearError::Malformed => CmdError::LinearApi,
        }
    }
}

pub struct AppState {
    pub pool: SqlitePool,
    pub secret_store: Arc<dyn SecretStore>,
    pub credentials: Arc<dyn LinearCredentialProvider>,
    pub linear: LinearClient,
    /// Serializes the credential-mutating commands (set/clear/test) so they can
    /// never interleave. Without it, a slow `test_connection` could finish and
    /// cache an identity for a key that a concurrent `set`/`clear` already
    /// replaced — leaving a stale "connected" name beside the wrong key. The UI
    /// guards against this too, but IPC calls can still overlap independently.
    pub op_lock: tokio::sync::Mutex<()>,
}

pub async fn set_linear_key_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    key: String,
) -> Result<(), CmdError> {
    // Invalidate any cached identity FIRST. If the keyring write later fails, the
    // old key may persist but the status safely falls back to "unverified" — we
    // never leave a stale "connected" name beside a freshly-changed key.
    db::clear_viewer_name(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.set(LINEAR_KEY_ACCOUNT, &key))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn clear_linear_key_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
) -> Result<(), CmdError> {
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.delete(LINEAR_KEY_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    db::clear_viewer_name(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(())
}

pub async fn get_status_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
) -> Result<ConnectionStatus, CmdError> {
    let s = store.clone();
    let has_key = tokio::task::spawn_blocking(move || s.get(LINEAR_KEY_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .is_some();
    let cached = db::load_viewer_name(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(compute_status(has_key, cached))
}

/// `fetch_viewer` is injected so this logic is unit-testable without the network.
/// The cache is only written AFTER a successful fetch, so a failed test leaves the
/// previously-cached identity untouched.
pub async fn test_connection_logic<F, Fut>(
    credentials: Arc<dyn LinearCredentialProvider>,
    pool: &SqlitePool,
    fetch_viewer: F,
) -> Result<ConnectionStatus, CmdError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<Viewer, LinearError>>,
{
    let c = credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::NotConfigured)?;
    let viewer = fetch_viewer(auth).await?;
    db::save_viewer_name(pool, &viewer.name)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(ConnectionStatus::Connected { name: viewer.name })
}

#[tauri::command]
pub async fn set_linear_key(state: State<'_, AppState>, key: String) -> Result<(), CmdError> {
    let _guard = state.op_lock.lock().await;
    set_linear_key_logic(state.secret_store.clone(), &state.pool, key).await
}

#[tauri::command]
pub async fn clear_linear_key(state: State<'_, AppState>) -> Result<(), CmdError> {
    let _guard = state.op_lock.lock().await;
    clear_linear_key_logic(state.secret_store.clone(), &state.pool).await
}

#[tauri::command]
pub async fn get_connection_status(
    state: State<'_, AppState>,
) -> Result<ConnectionStatus, CmdError> {
    get_status_logic(state.secret_store.clone(), &state.pool).await
}

#[tauri::command]
pub async fn test_linear_connection(
    state: State<'_, AppState>,
) -> Result<ConnectionStatus, CmdError> {
    let _guard = state.op_lock.lock().await;
    let client = state.linear.clone();
    test_connection_logic(
        state.credentials.clone(),
        &state.pool,
        move |auth| async move { client.viewer(&auth).await },
    )
    .await
}

#[cfg(test)]
mod status_tests {
    use super::*;

    #[test]
    fn no_key_is_not_configured() {
        assert_eq!(compute_status(false, None), ConnectionStatus::NotConfigured);
        assert_eq!(
            compute_status(false, Some("x".into())),
            ConnectionStatus::NotConfigured
        );
    }

    #[test]
    fn key_without_cache_is_unverified() {
        assert_eq!(compute_status(true, None), ConnectionStatus::Unverified);
    }

    #[test]
    fn key_with_cache_is_connected() {
        assert_eq!(
            compute_status(true, Some("Abrar".into())),
            ConnectionStatus::Connected {
                name: "Abrar".into()
            }
        );
    }

    #[test]
    fn connected_serializes_with_state_and_name() {
        let json = serde_json::to_string(&ConnectionStatus::Connected {
            name: "Abrar".into(),
        })
        .unwrap();
        assert_eq!(json, r#"{"state":"connected","name":"Abrar"}"#);
    }

    #[test]
    fn not_configured_serializes_with_state_only() {
        let json = serde_json::to_string(&ConnectionStatus::NotConfigured).unwrap();
        assert_eq!(json, r#"{"state":"not_configured"}"#);
    }
}

#[cfg(test)]
mod logic_tests {
    use super::*;
    use crate::linear::PersonalKeyProvider;
    use crate::secrets::fake::FakeSecretStore;

    async fn temp_pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = db::init_pool(&dir.path().join("astryn/test.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    fn viewer(name: &str) -> Viewer {
        Viewer {
            id: "u1".into(),
            name: name.into(),
            email: "a@b.c".into(),
        }
    }

    #[tokio::test]
    async fn no_key_reports_not_configured() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let status = get_status_logic(store, &pool).await.unwrap();
        assert_eq!(status, ConnectionStatus::NotConfigured);
    }

    #[tokio::test]
    async fn saving_key_reports_unverified() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        set_linear_key_logic(store.clone(), &pool, "lin_xyz".into())
            .await
            .unwrap();
        let status = get_status_logic(store, &pool).await.unwrap();
        assert_eq!(status, ConnectionStatus::Unverified);
    }

    #[tokio::test]
    async fn cached_identity_reports_connected() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        set_linear_key_logic(store.clone(), &pool, "lin_xyz".into())
            .await
            .unwrap();
        db::save_viewer_name(&pool, "Abrar").await.unwrap();
        let status = get_status_logic(store, &pool).await.unwrap();
        assert_eq!(
            status,
            ConnectionStatus::Connected {
                name: "Abrar".into()
            }
        );
    }

    #[tokio::test]
    async fn replacing_key_invalidates_cached_identity() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        set_linear_key_logic(store.clone(), &pool, "old".into())
            .await
            .unwrap();
        db::save_viewer_name(&pool, "Abrar").await.unwrap();
        set_linear_key_logic(store.clone(), &pool, "new".into())
            .await
            .unwrap();
        assert_eq!(db::load_viewer_name(&pool).await.unwrap(), None);
        let status = get_status_logic(store, &pool).await.unwrap();
        assert_eq!(status, ConnectionStatus::Unverified);
    }

    #[tokio::test]
    async fn clearing_key_removes_key_and_identity() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        set_linear_key_logic(store.clone(), &pool, "lin_xyz".into())
            .await
            .unwrap();
        db::save_viewer_name(&pool, "Abrar").await.unwrap();
        clear_linear_key_logic(store.clone(), &pool).await.unwrap();
        assert_eq!(store.get(LINEAR_KEY_ACCOUNT).unwrap(), None);
        assert_eq!(db::load_viewer_name(&pool).await.unwrap(), None);
        let status = get_status_logic(store, &pool).await.unwrap();
        assert_eq!(status, ConnectionStatus::NotConfigured);
    }

    #[tokio::test]
    async fn test_connection_persists_viewer_name() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(LINEAR_KEY_ACCOUNT, "lin_xyz").unwrap();
        let creds: Arc<dyn LinearCredentialProvider> =
            Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
        let status = test_connection_logic(creds, &pool, |_auth| async { Ok(viewer("Abrar")) })
            .await
            .unwrap();
        assert_eq!(
            status,
            ConnectionStatus::Connected {
                name: "Abrar".into()
            }
        );
        assert_eq!(
            db::load_viewer_name(&pool).await.unwrap(),
            Some("Abrar".to_string())
        );
    }

    #[tokio::test]
    async fn failed_test_leaves_cache_unchanged() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(LINEAR_KEY_ACCOUNT, "lin_xyz").unwrap();
        db::save_viewer_name(&pool, "Old Name").await.unwrap();
        let creds: Arc<dyn LinearCredentialProvider> =
            Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
        let result =
            test_connection_logic(creds, &pool, |_auth| async { Err(LinearError::Auth) }).await;
        assert!(result.is_err());
        assert_eq!(
            db::load_viewer_name(&pool).await.unwrap(),
            Some("Old Name".to_string())
        );
    }

    #[tokio::test]
    async fn test_connection_without_key_is_not_configured() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let creds: Arc<dyn LinearCredentialProvider> =
            Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
        let result = test_connection_logic(creds, &pool, |_auth| async { Ok(viewer("X")) }).await;
        assert!(matches!(result, Err(CmdError::NotConfigured)));
        assert_eq!(db::load_viewer_name(&pool).await.unwrap(), None);
    }
}
