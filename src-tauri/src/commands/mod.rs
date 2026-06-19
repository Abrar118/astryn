use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;

use crate::db;
use crate::linear::issues::OrgIdentity;
use crate::linear::{LinearClient, LinearCredentialProvider, LinearError};
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
    #[allow(dead_code)]
    #[error("Workspace changed; please retry.")]
    WorkspaceChanged,
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
            LinearError::RateLimited(_) => CmdError::RateLimited,
            LinearError::Auth | LinearError::Api(_) | LinearError::Malformed => CmdError::LinearApi,
        }
    }
}

pub struct AppState {
    pub pool: SqlitePool,
    pub secret_store: Arc<dyn SecretStore>,
    pub credentials: Arc<dyn LinearCredentialProvider>,
    pub linear: LinearClient,
    /// Serializes credential mutations and bulk sync (set/clear/test/sync).
    pub workspace_lock: tokio::sync::Mutex<()>,
    /// Bumped by every cache wipe; guards `update_issue`'s late write.
    pub workspace_generation: AtomicU64,
    /// Epoch-seconds deadline before which sync is suppressed after a 429 (0 = none).
    #[allow(dead_code)]
    pub rate_limited_until: AtomicU64,
}

pub async fn set_linear_key_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    key: String,
) -> Result<(), CmdError> {
    // Wipe + bump FIRST so a later keyring failure can only leave an empty cache
    // (safe), never the new key paired with the old workspace's data.
    db::issues::wipe_workspace_cache(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
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
    generation: &AtomicU64,
) -> Result<(), CmdError> {
    // Wipe + bump first; a failed delete then leaves an empty cache, which is safe.
    db::issues::wipe_workspace_cache(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.delete(LINEAR_KEY_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
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

pub async fn test_connection_logic<F, Fut>(
    credentials: Arc<dyn LinearCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    fetch_identity: F,
) -> Result<ConnectionStatus, CmdError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<OrgIdentity, LinearError>>,
{
    let c = credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::NotConfigured)?;
    let id = fetch_identity(auth).await?;
    // Compare BEFORE overwriting: a swapped key pointing at a different org wipes first.
    if let Some(cached) = db::load_org_id(pool)
        .await
        .map_err(|_| CmdError::Internal)?
    {
        if cached != id.org_id {
            db::issues::wipe_workspace_cache(pool)
                .await
                .map_err(|_| CmdError::Internal)?;
            generation.fetch_add(1, Ordering::SeqCst);
        }
    }
    db::save_identity(
        pool,
        &id.viewer_id,
        &id.viewer_name,
        &id.org_id,
        &id.org_name,
        &id.org_url_key,
    )
    .await
    .map_err(|_| CmdError::Internal)?;
    Ok(ConnectionStatus::Connected {
        name: id.viewer_name,
    })
}

#[tauri::command]
pub async fn set_linear_key(state: State<'_, AppState>, key: String) -> Result<(), CmdError> {
    let _g = state.workspace_lock.lock().await;
    set_linear_key_logic(
        state.secret_store.clone(),
        &state.pool,
        &state.workspace_generation,
        key,
    )
    .await
}

#[tauri::command]
pub async fn clear_linear_key(state: State<'_, AppState>) -> Result<(), CmdError> {
    let _g = state.workspace_lock.lock().await;
    clear_linear_key_logic(
        state.secret_store.clone(),
        &state.pool,
        &state.workspace_generation,
    )
    .await
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
    let _g = state.workspace_lock.lock().await;
    let client = state.linear.clone();
    test_connection_logic(
        state.credentials.clone(),
        &state.pool,
        &state.workspace_generation,
        move |auth| async move { client.viewer_with_org(&auth).await },
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

    fn gen0() -> AtomicU64 {
        AtomicU64::new(0)
    }

    fn org(id: &str) -> OrgIdentity {
        OrgIdentity {
            viewer_id: "v1".into(),
            viewer_name: "Abrar".into(),
            org_id: id.into(),
            org_name: "GAM".into(),
            org_url_key: "gam".into(),
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
    async fn cached_identity_reports_connected() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(LINEAR_KEY_ACCOUNT, "lin_xyz").unwrap();
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
    async fn saving_key_wipes_and_bumps_generation() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        db::save_identity(&pool, "v0", "Old", "org0", "Old", "old")
            .await
            .unwrap();
        let g = gen0();
        set_linear_key_logic(store.clone(), &pool, &g, "lin_xyz".into())
            .await
            .unwrap();
        assert_eq!(g.load(Ordering::SeqCst), 1);
        assert_eq!(db::load_org_id(&pool).await.unwrap(), None); // identity wiped
        let status = get_status_logic(store, &pool).await.unwrap();
        assert_eq!(status, ConnectionStatus::Unverified);
    }

    #[tokio::test]
    async fn clearing_key_wipes_and_bumps() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(LINEAR_KEY_ACCOUNT, "lin_xyz").unwrap();
        let g = gen0();
        clear_linear_key_logic(store.clone(), &pool, &g)
            .await
            .unwrap();
        assert_eq!(g.load(Ordering::SeqCst), 1);
        assert_eq!(store.get(LINEAR_KEY_ACCOUNT).unwrap(), None);
    }

    #[tokio::test]
    async fn test_connection_same_org_keeps_cache_and_saves_identity() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(LINEAR_KEY_ACCOUNT, "lin_xyz").unwrap();
        db::save_identity(&pool, "v1", "Abrar", "orgA", "GAM", "gam")
            .await
            .unwrap();
        let creds: Arc<dyn LinearCredentialProvider> =
            Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
        let g = AtomicU64::new(5);
        let status = test_connection_logic(creds, &pool, &g, |_a| async { Ok(org("orgA")) })
            .await
            .unwrap();
        assert_eq!(
            status,
            ConnectionStatus::Connected {
                name: "Abrar".into()
            }
        );
        assert_eq!(g.load(Ordering::SeqCst), 5); // same org -> no wipe -> no bump
    }

    #[tokio::test]
    async fn test_connection_different_org_wipes_and_bumps() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(LINEAR_KEY_ACCOUNT, "lin_xyz").unwrap();
        db::save_identity(&pool, "v1", "Abrar", "orgA", "GAM", "gam")
            .await
            .unwrap();
        let creds: Arc<dyn LinearCredentialProvider> =
            Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
        let g = AtomicU64::new(0);
        test_connection_logic(creds, &pool, &g, |_a| async { Ok(org("orgB")) })
            .await
            .unwrap();
        assert_eq!(g.load(Ordering::SeqCst), 1); // mismatch -> wipe -> bump
        assert_eq!(db::load_org_id(&pool).await.unwrap(), Some("orgB".into())); // new identity saved
    }
}
