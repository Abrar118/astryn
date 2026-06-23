mod commands;
mod db;
mod github;
mod linear;
mod link_preview;
mod secrets;
mod slack;

use std::sync::Arc;
use tauri::Manager;

use commands::AppState;
use github::{GitHubClient, GitHubCredentialProvider, PatProvider};
use linear::{LinearClient, LinearCredentialProvider, PersonalKeyProvider};
use secrets::{KeyringSecretStore, SecretStore};
use slack::{SlackClient, SlackCredentialProvider, PersonalTokenProvider};

const KEYCHAIN_SERVICE: &str = "com.orion.astryn";
const LINEAR_KEY_ACCOUNT: &str = "linear_api_key";
const GITHUB_TOKEN_ACCOUNT: &str = "github_token";
const SLACK_TOKEN_ACCOUNT: &str = "slack_user_token";
const SLACK_COOKIE_ACCOUNT: &str = "slack_cookie_d";

/// Build a macOS app menu mirroring the system default but WITHOUT the
/// "Close Window" item, so Cmd+W is left for the webview (which closes the
/// active tab). Keeps Quit and the Edit items so native shortcuts still work.
#[cfg(target_os = "macos")]
fn install_macos_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, SubmenuBuilder};

    let app_menu = SubmenuBuilder::new(app, "Astryn")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // DB lives in the app data dir (~/Library/Application Support/com.orion.astryn
            // on macOS), created by init_pool if missing. NOT ~/Documents: that folder is
            // TCC-protected on macOS, so a launchd/Finder-launched app is denied access and
            // SQLite fails with SQLITE_CANTOPEN. The DB is a re-syncable cache (no secrets).
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("could not resolve app data dir");
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
            let slack_credentials: Arc<dyn SlackCredentialProvider> = Arc::new(
                PersonalTokenProvider::new(store.clone(), SLACK_TOKEN_ACCOUNT, SLACK_COOKIE_ACCOUNT),
            );
            let slack = SlackClient::new().expect("failed to build Slack HTTP client");

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
                slack_credentials,
                slack,
                slack_lock: tokio::sync::Mutex::new(()),
                slack_generation: std::sync::atomic::AtomicU64::new(0),
            });

            // macOS: replace the default app menu with one that OMITS "Close
            // Window" so its Cmd+W accelerator doesn't fire before the webview.
            // The frontend binds Cmd/Ctrl+W to close the active tab instead.
            #[cfg(target_os = "macos")]
            install_macos_menu(app)?;

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
            commands::create_issue_relation,
            commands::create_attachment_link,
            commands::update_attachment,
            commands::delete_attachment,
            commands::upload_file,
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
            commands::github::sync_github_contributions,
            commands::slack::set_slack_token,
            commands::slack::clear_slack_token,
            commands::slack::get_slack_status,
            commands::slack::test_slack_connection,
            commands::slack::sync_slack_catchup,
            commands::slack::get_slack_catchup,
            commands::slack::get_slack_conversation_messages,
            commands::slack::slack_deep_link
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
