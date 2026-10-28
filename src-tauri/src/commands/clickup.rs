//! ClickUp connection commands: store/clear the personal token, report status,
//! and test the connection. Docs-source commands for ClickUp live in `docs.rs`.

use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;

use super::{AppState, CmdError};
use crate::clickup::{docs as cdocs, ClickUpCredentialProvider, ClickUpError};
use crate::db;
use crate::db::docs::{wipe_clickup_cache, CLICKUP_USERNAME_KEY};
use crate::secrets::SecretStore;

pub const CLICKUP_TOKEN_ACCOUNT: &str = "clickup_token";

impl From<ClickUpError> for CmdError {
    fn from(e: ClickUpError) -> Self {
        match e {
            ClickUpError::Network | ClickUpError::Server => CmdError::Network,
            ClickUpError::RateLimited(_) => CmdError::RateLimited,
            ClickUpError::Auth | ClickUpError::Api(_) | ClickUpError::Malformed => {
                CmdError::ClickUpApi
            }
        }
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ClickUpStatus {
    NotConfigured,
    Unverified,
    Connected { username: String },
}

/// The `Authorization` value, off the async executor; `ClickUpNotConfigured`
/// without a stored token.
pub async fn clickup_auth(
    credentials: Arc<dyn ClickUpCredentialProvider>,
) -> Result<String, CmdError> {
    tokio::task::spawn_blocking(move || credentials.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::ClickUpNotConfigured)
}

/// Store a new token. The previous token's cached pages are wiped and in-flight
/// syncs invalidated FIRST, so a later keyring failure leaves an empty cache —
/// never the new token paired with another account's pages.
pub async fn set_clickup_token_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    token: String,
) -> Result<(), CmdError> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(CmdError::InvalidInput);
    }
    wipe_clickup_cache(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    tokio::task::spawn_blocking(move || store.set(CLICKUP_TOKEN_ACCOUNT, &token))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)
}

pub async fn clear_clickup_token_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
) -> Result<(), CmdError> {
    wipe_clickup_cache(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    tokio::task::spawn_blocking(move || store.delete(CLICKUP_TOKEN_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)
}

/// Offline status: whether a token is stored, and the user name a successful
/// connection test cached.
pub async fn get_clickup_status_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
) -> Result<ClickUpStatus, CmdError> {
    let has_token = tokio::task::spawn_blocking(move || store.get(CLICKUP_TOKEN_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .is_some();
    let username = db::load_setting(pool, CLICKUP_USERNAME_KEY)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(match (has_token, username) {
        (false, _) => ClickUpStatus::NotConfigured,
        (true, Some(username)) => ClickUpStatus::Connected { username },
        (true, None) => ClickUpStatus::Unverified,
    })
}

pub async fn test_clickup_connection_logic<F, Fut>(
    credentials: Arc<dyn ClickUpCredentialProvider>,
    pool: &SqlitePool,
    fetch_user: F,
) -> Result<ClickUpStatus, CmdError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<serde_json::Value, ClickUpError>>,
{
    let auth = clickup_auth(credentials).await?;
    let username = cdocs::parse_user(&fetch_user(auth).await?)?;
    db::save_setting(pool, CLICKUP_USERNAME_KEY, &username)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(ClickUpStatus::Connected { username })
}

#[tauri::command]
pub async fn set_clickup_token(state: State<'_, AppState>, token: String) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::Clickup)?;
    let _g = state.clickup_lock.lock().await;
    set_clickup_token_logic(
        state.secret_store.clone(),
        &state.pool,
        &state.clickup_generation,
        token,
    )
    .await
}

#[tauri::command]
pub async fn clear_clickup_token(state: State<'_, AppState>) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::Clickup)?;
    let _g = state.clickup_lock.lock().await;
    clear_clickup_token_logic(
        state.secret_store.clone(),
        &state.pool,
        &state.clickup_generation,
    )
    .await
}

#[tauri::command]
pub async fn get_clickup_status(state: State<'_, AppState>) -> Result<ClickUpStatus, CmdError> {
    get_clickup_status_logic(state.secret_store.clone(), &state.pool).await
}

#[tauri::command]
pub async fn test_clickup_connection(
    state: State<'_, AppState>,
) -> Result<ClickUpStatus, CmdError> {
    state.require(crate::modules::ModuleId::Clickup)?;
    let _g = state.clickup_lock.lock().await;
    let client = state.clickup.clone();
    test_clickup_connection_logic(
        state.clickup_credentials.clone(),
        &state.pool,
        move |auth| async move { client.get(&auth, cdocs::USER_PATH).await },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clickup::fake::FakeClickUpCreds;
    use crate::secrets::fake::FakeSecretStore;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    #[tokio::test]
    async fn status_goes_from_not_configured_to_connected() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        assert_eq!(
            get_clickup_status_logic(store.clone(), &pool)
                .await
                .unwrap(),
            ClickUpStatus::NotConfigured
        );

        let gen = AtomicU64::new(0);
        set_clickup_token_logic(store.clone(), &pool, &gen, "  pk_1_X  ".into())
            .await
            .unwrap();
        assert_eq!(
            store.get(CLICKUP_TOKEN_ACCOUNT).unwrap().as_deref(),
            Some("pk_1_X")
        );
        assert_eq!(gen.load(Ordering::SeqCst), 1);
        assert_eq!(
            get_clickup_status_logic(store.clone(), &pool)
                .await
                .unwrap(),
            ClickUpStatus::Unverified
        );

        let creds: Arc<dyn ClickUpCredentialProvider> =
            Arc::new(FakeClickUpCreds(Some("pk_1_X".into())));
        let status = test_clickup_connection_logic(creds, &pool, |auth| async move {
            assert_eq!(auth, "pk_1_X"); // raw token, no Bearer
            Ok(serde_json::json!({ "user": { "id": 1, "username": "Abrar" } }))
        })
        .await
        .unwrap();
        assert_eq!(
            status,
            ClickUpStatus::Connected {
                username: "Abrar".into()
            }
        );
        assert_eq!(
            get_clickup_status_logic(store, &pool).await.unwrap(),
            status
        );
    }

    #[tokio::test]
    async fn blank_tokens_are_rejected_and_clearing_forgets_everything() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let gen = AtomicU64::new(0);
        assert!(matches!(
            set_clickup_token_logic(store.clone(), &pool, &gen, "   ".into()).await,
            Err(CmdError::InvalidInput)
        ));
        store.set(CLICKUP_TOKEN_ACCOUNT, "pk").unwrap();
        db::save_setting(&pool, CLICKUP_USERNAME_KEY, "Abrar")
            .await
            .unwrap();
        clear_clickup_token_logic(store.clone(), &pool, &gen)
            .await
            .unwrap();
        assert_eq!(store.get(CLICKUP_TOKEN_ACCOUNT).unwrap(), None);
        assert_eq!(
            get_clickup_status_logic(store, &pool).await.unwrap(),
            ClickUpStatus::NotConfigured
        );
        assert_eq!(gen.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn connection_test_needs_a_token_and_maps_rejections() {
        let (_d, pool) = pool().await;
        let none: Arc<dyn ClickUpCredentialProvider> = Arc::new(FakeClickUpCreds(None));
        assert!(matches!(
            test_clickup_connection_logic(none, &pool, |_| async { Ok(serde_json::json!({})) })
                .await,
            Err(CmdError::ClickUpNotConfigured)
        ));
        let some: Arc<dyn ClickUpCredentialProvider> =
            Arc::new(FakeClickUpCreds(Some("pk".into())));
        assert!(matches!(
            test_clickup_connection_logic(some, &pool, |_| async { Err(ClickUpError::Auth) }).await,
            Err(CmdError::ClickUpApi)
        ));
    }
}
