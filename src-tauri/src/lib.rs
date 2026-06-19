mod commands;
mod db;
mod linear;
mod secrets;

use std::sync::Arc;
use tauri::Manager;

use commands::AppState;
use linear::{LinearClient, LinearCredentialProvider, PersonalKeyProvider};
use secrets::{KeyringSecretStore, SecretStore};

const KEYCHAIN_SERVICE: &str = "com.orion.astryn";
const LINEAR_KEY_ACCOUNT: &str = "linear_api_key";

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

            let store: Arc<dyn SecretStore> = Arc::new(KeyringSecretStore::new(KEYCHAIN_SERVICE));
            let credentials: Arc<dyn LinearCredentialProvider> =
                Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
            let linear = LinearClient::new().expect("failed to build Linear HTTP client");

            app.manage(AppState {
                pool,
                secret_store: store,
                credentials,
                linear,
                workspace_lock: tokio::sync::Mutex::new(()),
                workspace_generation: std::sync::atomic::AtomicU64::new(0),
                rate_limited_until: std::sync::atomic::AtomicU64::new(0),
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
            commands::update_issue,
            commands::list_users,
            commands::list_labels,
            commands::list_cycles,
            commands::delete_issue,
            commands::get_me
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
