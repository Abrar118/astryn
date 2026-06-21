use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;

use super::{AppState, CmdError};
use crate::db::github as gdb;
use crate::github::{GitHubCredentialProvider, GitHubError};
use crate::secrets::SecretStore;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::fake::FakeGitHubCreds;
    use crate::secrets::fake::FakeSecretStore;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db")).await.unwrap();
        (dir, pool)
    }

    #[test]
    fn status_computation() {
        assert!(matches!(compute_github_status(false, None), GitHubStatus::NotConfigured));
        assert!(matches!(compute_github_status(true, None), GitHubStatus::Unverified));
        match compute_github_status(true, Some("octocat".into())) {
            GitHubStatus::Connected { login } => assert_eq!(login, "octocat"),
            _ => panic!("expected Connected"),
        }
    }

    #[tokio::test]
    async fn set_token_wipes_prior_github_state() {
        let (_d, pool) = pool().await;
        // Seed prior account's login so we can prove it is wiped.
        gdb::save_github_login(&pool, "olduser").await.unwrap();
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let gen = AtomicU64::new(0);
        set_github_token_logic(store.clone(), &pool, &gen, "ghp_new".into()).await.unwrap();
        assert_eq!(gdb::load_github_login(&pool).await.unwrap(), None);
        assert_eq!(gen.load(Ordering::SeqCst), 1);
        assert_eq!(store.get(GITHUB_TOKEN_ACCOUNT).unwrap(), Some("ghp_new".into()));
    }

    #[tokio::test]
    async fn get_status_is_offline() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        assert!(matches!(
            get_github_status_logic(store.clone(), &pool).await.unwrap(),
            GitHubStatus::NotConfigured
        ));
        store.set(GITHUB_TOKEN_ACCOUNT, "ghp_x").unwrap();
        gdb::save_github_login(&pool, "octocat").await.unwrap();
        match get_github_status_logic(store, &pool).await.unwrap() {
            GitHubStatus::Connected { login } => assert_eq!(login, "octocat"),
            _ => panic!("expected Connected"),
        }
    }

    #[tokio::test]
    async fn test_connection_caches_login() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let status = test_github_connection_logic(creds, &pool, |_auth| async {
            Ok("octocat".to_string())
        })
        .await
        .unwrap();
        assert!(matches!(status, GitHubStatus::Connected { .. }));
        assert_eq!(gdb::load_github_login(&pool).await.unwrap(), Some("octocat".into()));
    }
}

use super::GITHUB_TOKEN_ACCOUNT;

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum GitHubStatus {
    NotConfigured,
    Unverified,
    Connected { login: String },
}

pub fn compute_github_status(has_token: bool, login: Option<String>) -> GitHubStatus {
    match (has_token, login) {
        (false, _) => GitHubStatus::NotConfigured,
        (true, Some(login)) => GitHubStatus::Connected { login },
        (true, None) => GitHubStatus::Unverified,
    }
}

pub async fn set_github_token_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    token: String,
) -> Result<(), CmdError> {
    // Wipe + bump FIRST so a later keyring failure leaves an empty cache (safe),
    // never the new token paired with the previous account's data.
    gdb::wipe_github_cache(pool).await.map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.set(GITHUB_TOKEN_ACCOUNT, &token))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn clear_github_token_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
) -> Result<(), CmdError> {
    gdb::wipe_github_cache(pool).await.map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.delete(GITHUB_TOKEN_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn get_github_status_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
) -> Result<GitHubStatus, CmdError> {
    let s = store.clone();
    let has_token = tokio::task::spawn_blocking(move || s.get(GITHUB_TOKEN_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .is_some();
    let login = gdb::load_github_login(pool).await.map_err(|_| CmdError::Internal)?;
    Ok(compute_github_status(has_token, login))
}

pub async fn test_github_connection_logic<F, Fut>(
    credentials: Arc<dyn GitHubCredentialProvider>,
    pool: &SqlitePool,
    fetch_login: F,
) -> Result<GitHubStatus, CmdError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<String, GitHubError>>,
{
    let c = credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::GitHubNotConfigured)?;
    let login = fetch_login(auth).await?;
    gdb::save_github_login(pool, &login).await.map_err(|_| CmdError::Internal)?;
    Ok(GitHubStatus::Connected { login })
}

/// GraphQL `viewer { login }` against the live client.
async fn fetch_viewer_login(
    client: &crate::github::GitHubClient,
    auth: String,
) -> Result<String, GitHubError> {
    let body = serde_json::json!({ "query": "query{ viewer { login } }" });
    let data = client.graphql(&auth, body).await?;
    data.get("viewer")
        .and_then(|v| v.get("login"))
        .and_then(|l| l.as_str())
        .map(Into::into)
        .ok_or(GitHubError::Malformed)
}

#[tauri::command]
pub async fn set_github_token(state: State<'_, AppState>, token: String) -> Result<(), CmdError> {
    let _g = state.github_lock.lock().await;
    set_github_token_logic(state.secret_store.clone(), &state.pool, &state.github_generation, token).await
}

#[tauri::command]
pub async fn clear_github_token(state: State<'_, AppState>) -> Result<(), CmdError> {
    let _g = state.github_lock.lock().await;
    clear_github_token_logic(state.secret_store.clone(), &state.pool, &state.github_generation).await
}

#[tauri::command]
pub async fn get_github_status(state: State<'_, AppState>) -> Result<GitHubStatus, CmdError> {
    get_github_status_logic(state.secret_store.clone(), &state.pool).await
}

#[tauri::command]
pub async fn test_github_connection(state: State<'_, AppState>) -> Result<GitHubStatus, CmdError> {
    let _g = state.github_lock.lock().await;
    let client = state.github.clone();
    test_github_connection_logic(
        state.github_credentials.clone(),
        &state.pool,
        move |auth| async move { fetch_viewer_login(&client, auth).await },
    )
    .await
}
