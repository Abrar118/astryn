use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;

use super::{AppState, CmdError};
use crate::db::slack as sdb;
use crate::slack::catchup::{self, AuthTest};
use crate::slack::{SlackCredentialProvider, SlackError};
use crate::secrets::SecretStore;

use super::super::SLACK_TOKEN_ACCOUNT;

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SlackStatus {
    NotConfigured,
    Unverified,
    Connected {
        #[serde(rename = "workspaceName")]
        workspace_name: Option<String>,
        #[serde(rename = "userName")]
        user_name: String,
    },
}

pub fn compute_slack_status(has_token: bool, identity: Option<sdb::SlackIdentity>) -> SlackStatus {
    match (has_token, identity) {
        (false, _) => SlackStatus::NotConfigured,
        (true, Some(id)) => SlackStatus::Connected {
            workspace_name: id.workspace_name,
            user_name: id.user_id,
        },
        (true, None) => SlackStatus::Unverified,
    }
}

pub async fn set_slack_token_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    token: String,
) -> Result<(), CmdError> {
    // Wipe + bump BEFORE the keyring write so a keyring failure leaves an empty
    // cache (safe), never the new token paired with the prior account's data.
    sdb::wipe_slack_cache(pool).await.map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.set(SLACK_TOKEN_ACCOUNT, &token))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn clear_slack_token_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
) -> Result<(), CmdError> {
    sdb::wipe_slack_cache(pool).await.map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.delete(SLACK_TOKEN_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn get_slack_status_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
) -> Result<SlackStatus, CmdError> {
    let s = store.clone();
    let has_token = tokio::task::spawn_blocking(move || s.get(SLACK_TOKEN_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .is_some();
    let identity = sdb::load_slack_identity(pool).await.map_err(|_| CmdError::Internal)?;
    Ok(compute_slack_status(has_token, identity))
}

async fn authorize(credentials: &Arc<dyn SlackCredentialProvider>) -> Result<String, CmdError> {
    let c = credentials.clone();
    tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::SlackNotConfigured)
}

pub async fn test_slack_connection_logic<F, Fut>(
    credentials: Arc<dyn SlackCredentialProvider>,
    pool: &SqlitePool,
    fetch_auth: F,
) -> Result<SlackStatus, CmdError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<AuthTest, SlackError>>,
{
    let auth = authorize(&credentials).await?;
    let a = fetch_auth(auth).await.map_err(map_slack_err)?;
    let workspace_name = workspace_name_from_url(&a.url);
    sdb::save_slack_identity(pool, &a.user_id, &a.team_id, &a.url, workspace_name.as_deref())
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(SlackStatus::Connected {
        workspace_name,
        user_name: a.user_id,
    })
}

/// Best-effort workspace label from the team URL (e.g. https://acme.slack.com/ -> "acme").
fn workspace_name_from_url(url: &str) -> Option<String> {
    url.strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .and_then(|rest| rest.split('.').next())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub fn map_slack_err(e: SlackError) -> CmdError {
    match e {
        SlackError::Network => CmdError::Network,
        SlackError::Auth => CmdError::SlackNotConfigured,
        SlackError::RateLimited(_) => CmdError::RateLimited,
        SlackError::Server | SlackError::Malformed | SlackError::Api(_) => CmdError::SlackApi,
    }
}

/// Live `auth.test`.
async fn fetch_auth_test(client: &crate::slack::SlackClient, auth: String) -> Result<AuthTest, SlackError> {
    let body = client.call(&auth, "auth.test", &[]).await?;
    catchup::parse_auth_test(&body)
}

#[tauri::command]
pub async fn set_slack_token(state: State<'_, AppState>, token: String) -> Result<(), CmdError> {
    let _g = state.slack_lock.lock().await;
    set_slack_token_logic(state.secret_store.clone(), &state.pool, &state.slack_generation, token).await
}

#[tauri::command]
pub async fn clear_slack_token(state: State<'_, AppState>) -> Result<(), CmdError> {
    let _g = state.slack_lock.lock().await;
    clear_slack_token_logic(state.secret_store.clone(), &state.pool, &state.slack_generation).await
}

#[tauri::command]
pub async fn get_slack_status(state: State<'_, AppState>) -> Result<SlackStatus, CmdError> {
    get_slack_status_logic(state.secret_store.clone(), &state.pool).await
}

#[tauri::command]
pub async fn test_slack_connection(state: State<'_, AppState>) -> Result<SlackStatus, CmdError> {
    let _g = state.slack_lock.lock().await;
    let client = state.slack.clone();
    test_slack_connection_logic(state.slack_credentials.clone(), &state.pool, move |auth| async move {
        fetch_auth_test(&client, auth).await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::fake::FakeSecretStore;
    use crate::slack::catchup::AuthTest;
    use crate::slack::fake::FakeSlackCreds;
    use crate::slack::SlackCredentialProvider;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db")).await.unwrap();
        (dir, pool)
    }

    #[test]
    fn status_computation() {
        assert!(matches!(compute_slack_status(false, None), SlackStatus::NotConfigured));
        assert!(matches!(compute_slack_status(true, None), SlackStatus::Unverified));
        let id = crate::db::slack::SlackIdentity {
            user_id: "U1".into(), team_id: "T1".into(), url: "u".into(), workspace_name: Some("Acme".into()),
        };
        match compute_slack_status(true, Some(id)) {
            SlackStatus::Connected { user_name, workspace_name } => {
                assert_eq!(user_name, "U1");
                assert_eq!(workspace_name.as_deref(), Some("Acme"));
            }
            _ => panic!("expected Connected"),
        }
    }

    #[tokio::test]
    async fn set_token_wipes_prior_slack_state() {
        let (_d, pool) = pool().await;
        crate::db::slack::save_slack_identity(&pool, "old", "T", "u", None).await.unwrap();
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let gen = AtomicU64::new(0);
        set_slack_token_logic(store.clone(), &pool, &gen, "xoxp-new".into()).await.unwrap();
        assert_eq!(crate::db::slack::load_slack_identity(&pool).await.unwrap(), None);
        assert_eq!(gen.load(Ordering::SeqCst), 1);
        assert_eq!(store.get(SLACK_TOKEN_ACCOUNT).unwrap(), Some("xoxp-new".into()));
    }

    #[tokio::test]
    async fn get_status_is_offline() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        assert!(matches!(get_slack_status_logic(store.clone(), &pool).await.unwrap(), SlackStatus::NotConfigured));
        store.set(SLACK_TOKEN_ACCOUNT, "xoxp-x").unwrap();
        assert!(matches!(get_slack_status_logic(store.clone(), &pool).await.unwrap(), SlackStatus::Unverified));
        crate::db::slack::save_slack_identity(&pool, "U1", "T1", "u", Some("Acme")).await.unwrap();
        match get_slack_status_logic(store, &pool).await.unwrap() {
            SlackStatus::Connected { user_name, .. } => assert_eq!(user_name, "U1"),
            _ => panic!("expected Connected"),
        }
    }

    #[tokio::test]
    async fn test_connection_caches_identity() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn SlackCredentialProvider> = Arc::new(FakeSlackCreds(Some("Bearer x".into())));
        let status = test_slack_connection_logic(creds, &pool, |_auth| async {
            Ok(AuthTest { user_id: "U1".into(), team_id: "T1".into(), url: "https://acme.slack.com/".into(), user: "abrar".into() })
        })
        .await
        .unwrap();
        assert!(matches!(status, SlackStatus::Connected { .. }));
        let id = crate::db::slack::load_slack_identity(&pool).await.unwrap().unwrap();
        assert_eq!(id.team_id, "T1");
    }

    #[tokio::test]
    async fn test_connection_without_token_is_not_configured_error() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn SlackCredentialProvider> = Arc::new(FakeSlackCreds(None));
        let r = test_slack_connection_logic(creds, &pool, |_a| async {
            Ok(AuthTest { user_id: "U1".into(), team_id: "T1".into(), url: "u".into(), user: "x".into() })
        })
        .await;
        assert!(matches!(r, Err(CmdError::SlackNotConfigured)));
    }
}
