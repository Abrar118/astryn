mod commands;
mod db;
mod github;
mod linear;
mod link_preview;
mod secrets;

use std::sync::Arc;
use tauri::Manager;

use commands::AppState;
use github::{GitHubClient, GitHubCredentialProvider, PatProvider};
use linear::{LinearClient, LinearCredentialProvider, PersonalKeyProvider};
use secrets::{KeyringSecretStore, SecretStore};

const KEYCHAIN_SERVICE: &str = "com.orion.astryn";
const LINEAR_KEY_ACCOUNT: &str = "linear_api_key";
const GITHUB_TOKEN_ACCOUNT: &str = "github_token";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // DB lives in ~/Documents/astryn/astryn.db (created by init_pool if missing).
            let data_dir = app
                .path()
                .document_dir()
                .expect("could not resolve Documents dir")
                .join("astryn");
            let db_path = data_dir.join("astryn.db");
            let pool = tauri::async_runtime::block_on(db::init_pool(&db_path))
                .expect("failed to initialize database (directory or migrations)");
            tauri::async_runtime::block_on(db::issues::recover_pending_deletes(&pool))
                .expect("failed to recover pending issue deletions");

            let store: Arc<dyn SecretStore> = Arc::new(KeyringSecretStore::new(KEYCHAIN_SERVICE));
            let credentials: Arc<dyn LinearCredentialProvider> =
                Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
            let linear = LinearClient::new().expect("failed to build Linear HTTP client");
            let github_credentials: Arc<dyn GitHubCredentialProvider> =
                Arc::new(PatProvider::new(store.clone(), GITHUB_TOKEN_ACCOUNT));
            let github = GitHubClient::new().expect("failed to build GitHub HTTP client");

            app.manage(AppState {
                pool,
                secret_store: store,
                credentials,
                linear,
                workspace_lock: tokio::sync::Mutex::new(()),
                workspace_generation: std::sync::atomic::AtomicU64::new(0),
                rate_limited_until: std::sync::atomic::AtomicU64::new(0),
                link_preview_cache: tokio::sync::Mutex::new(
                    crate::link_preview::cache::PreviewCache::new(
                        128,
                        std::time::Duration::from_secs(600),
                    ),
                ),
                link_preview_inflight: std::sync::Mutex::new(std::collections::HashMap::new()),
                github_credentials,
                github,
                github_lock: tokio::sync::Mutex::new(()),
                github_generation: std::sync::atomic::AtomicU64::new(0),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_linear_key,
            commands::clear_linear_key,
            commands::get_connection_status,
            commands::test_linear_connection,
            commands::sync_issues,
            commands::list_calendar_issues,
            commands::list_unscheduled,
            commands::list_issues,
            commands::list_filter_options,
            commands::get_issue_detail,
            commands::load_linear_image,
            commands::fetch_link_preview,
            commands::update_issue,
            commands::create_issue,
            commands::list_users,
            commands::list_notifications,
            commands::list_labels,
            commands::list_cycles,
            commands::list_workflow_states,
            commands::delete_issue,
            commands::get_me,
            commands::create_comment,
            commands::update_comment,
            commands::delete_comment,
            commands::add_reaction,
            commands::remove_reaction,
            commands::create_label,
            commands::list_relations,
            commands::github::set_github_token,
            commands::github::clear_github_token,
            commands::github::get_github_status,
            commands::github::test_github_connection,
            commands::github::sync_github_prs,
            commands::github::list_github_prs,
            commands::github::get_github_contributions,
            commands::github::sync_github_contributions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
