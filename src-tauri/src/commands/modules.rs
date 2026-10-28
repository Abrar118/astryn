//! Module management commands: list, enable/disable, and remove a module's data.

use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

use super::bitbucket::{BITBUCKET_EMAIL_ACCOUNT, BITBUCKET_TOKEN_ACCOUNT};
use super::reports::{LLM_BASE_URL_KEY, LLM_MODEL_KEY};
use super::{AppState, CmdError, GITHUB_TOKEN_ACCOUNT, LINEAR_KEY_ACCOUNT, LLM_API_KEY_ACCOUNT};
use crate::db;
use crate::modules::screens::{self, ScreenId};
use crate::modules::{self, Capability, ModuleId, ModuleKind, ModuleState};
use crate::secrets::SecretStore;

const SLACK_ACCOUNTS: [&str; 2] = ["slack_user_token", "slack_cookie_d"];

/// Serializes module and screen writes so the persisted state and the in-memory
/// state are swapped together; overlapping writes could otherwise disagree.
/// One per process, like `AppState`.
static MODULES_WRITE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModuleInfo {
    pub id: ModuleId,
    pub kind: ModuleKind,
    pub enabled: bool,
    pub available: bool,
    pub missing: Vec<Capability>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModulesView {
    pub onboarded: bool,
    pub modules: Vec<ModuleInfo>,
    /// Filled from `AppState::screens` by `modules_view`.
    pub disabled_screens: Vec<ScreenId>,
}

pub fn list_modules_logic(state: &ModuleState) -> ModulesView {
    let modules = ModuleId::ALL
        .iter()
        .map(|&id| {
            let missing = modules::missing_capabilities(id, &state.enabled);
            ModuleInfo {
                id,
                kind: modules::spec(id).kind,
                enabled: state.enabled.contains(&id),
                available: missing.is_empty(),
                missing,
            }
        })
        .collect();
    ModulesView {
        onboarded: state.onboarded,
        modules,
        disabled_screens: Vec::new(),
    }
}

fn modules_view(state: &AppState) -> Result<ModulesView, CmdError> {
    let mut view = list_modules_logic(&*state.modules.read().map_err(|_| CmdError::Internal)?);
    view.disabled_screens = state
        .screens
        .read()
        .map_err(|_| CmdError::Internal)?
        .iter()
        .copied()
        .collect();
    Ok(view)
}

/// Ok unless `id` is switched off. Reuses the module error: the frontend
/// already treats it as a silent cancellation.
pub fn require_screen_in(disabled: &BTreeSet<ScreenId>, id: ScreenId) -> Result<(), CmdError> {
    if disabled.contains(&id) {
        Err(CmdError::ModuleDisabled)
    } else {
        Ok(())
    }
}

impl AppState {
    pub fn require_screen(&self, id: ScreenId) -> Result<(), CmdError> {
        require_screen_in(&self.screens.read().unwrap_or_else(|e| e.into_inner()), id)
    }
}

/// Persist the new disabled-screen set, then swap it in.
pub async fn set_disabled_screens_logic(
    pool: &SqlitePool,
    current: &RwLock<BTreeSet<ScreenId>>,
    ids: Vec<ScreenId>,
) -> Result<(), CmdError> {
    let _w = MODULES_WRITE.lock().await;
    let next = ids.into_iter().collect::<BTreeSet<_>>();
    screens::save_disabled(pool, &next)
        .await
        .map_err(|_| CmdError::Internal)?;
    *current.write().map_err(|_| CmdError::Internal)? = next;
    Ok(())
}

/// Persist the new enabled set (marking the app onboarded) and return the
/// modules that were enabled before and are not any more.
pub async fn set_enabled_modules_logic(
    pool: &SqlitePool,
    modules: &RwLock<ModuleState>,
    ids: Vec<ModuleId>,
) -> Result<Vec<ModuleId>, CmdError> {
    let _w = MODULES_WRITE.lock().await;
    let next = ModuleState {
        enabled: ids.into_iter().collect::<BTreeSet<_>>(),
        onboarded: true,
    };
    modules::save_state(pool, &next)
        .await
        .map_err(|_| CmdError::Internal)?;
    let mut guard = modules.write().map_err(|_| CmdError::Internal)?;
    let disabled = guard
        .enabled
        .difference(&next.enabled)
        .copied()
        .collect::<Vec<_>>();
    *guard = next;
    Ok(disabled)
}

/// Delete a disabled module's cached data and stored credentials.
pub async fn remove_module_data_logic(
    pool: &SqlitePool,
    store: &dyn SecretStore,
    state: &ModuleState,
    id: ModuleId,
) -> Result<(), CmdError> {
    if state.enabled.contains(&id) {
        return Err(CmdError::InvalidInput);
    }
    let db_err = |_| CmdError::Internal;
    let secret_err = |_| CmdError::SecretStore;
    match id {
        ModuleId::Linear => {
            db::issues::wipe_workspace_cache(pool)
                .await
                .map_err(db_err)?;
            store.delete(LINEAR_KEY_ACCOUNT).map_err(secret_err)?;
        }
        ModuleId::Github => {
            db::github::wipe_github_cache(pool).await.map_err(db_err)?;
            store.delete(GITHUB_TOKEN_ACCOUNT).map_err(secret_err)?;
        }
        ModuleId::Slack => {
            db::slack::wipe_slack_cache(pool).await.map_err(db_err)?;
            for account in SLACK_ACCOUNTS {
                store.delete(account).map_err(secret_err)?;
            }
        }
        ModuleId::Llm => {
            sqlx::query("DELETE FROM settings WHERE key IN (?1, ?2)")
                .bind(LLM_BASE_URL_KEY)
                .bind(LLM_MODEL_KEY)
                .execute(pool)
                .await
                .map_err(db_err)?;
            store.delete(LLM_API_KEY_ACCOUNT).map_err(secret_err)?;
        }
        ModuleId::Teams => {
            db::teams::remove_all_teams_data(pool)
                .await
                .map_err(db_err)?;
            crate::teams::clear_refresh_token(store).map_err(secret_err)?;
        }
        ModuleId::Docs => {
            let mut tx = pool.begin().await.map_err(db_err)?;
            for t in ["docs_files", "docs_sync_meta", "docs_sources"] {
                sqlx::query(&format!("DELETE FROM {t}"))
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
            }
            tx.commit().await.map_err(db_err)?;
        }
        ModuleId::Bitbucket => {
            db::bitbucket::wipe_bitbucket_cache(pool)
                .await
                .map_err(db_err)?;
            for account in [BITBUCKET_TOKEN_ACCOUNT, BITBUCKET_EMAIL_ACCOUNT] {
                store.delete(account).map_err(secret_err)?;
            }
        }
        ModuleId::Clickup => {
            db::docs::wipe_clickup_cache(pool).await.map_err(db_err)?;
            store
                .delete(super::clickup::CLICKUP_TOKEN_ACCOUNT)
                .map_err(secret_err)?;
        }
        // Nothing persisted: in-memory state only.
        ModuleId::Reports | ModuleId::LinkPreviews => {}
    }
    Ok(())
}

/// Remove a module's data while holding the module write lock, so the module
/// cannot be re-enabled between the "is it disabled?" check and the wipe.
/// The std read guard is released before any await; only the async lock spans the work.
pub async fn remove_module_data_locked(
    pool: &SqlitePool,
    store: &dyn SecretStore,
    modules: &RwLock<ModuleState>,
    id: ModuleId,
) -> Result<(), CmdError> {
    let _w = MODULES_WRITE.lock().await;
    let snapshot = modules.read().map_err(|_| CmdError::Internal)?.clone();
    remove_module_data_logic(pool, store, &snapshot, id).await
}

/// Generation counters of the providers whose in-flight work a disable cancels.
struct Generations<'a> {
    linear: &'a AtomicU64,
    github: &'a AtomicU64,
    slack: &'a AtomicU64,
    llm: &'a AtomicU64,
    teams: &'a AtomicU64,
}

/// Bump the generation counter of every disabled provider.
fn bump_generations(disabled: &[ModuleId], g: &Generations) {
    for id in disabled {
        let counter = match id {
            ModuleId::Linear => g.linear,
            ModuleId::Github => g.github,
            ModuleId::Slack => g.slack,
            ModuleId::Llm => g.llm,
            ModuleId::Teams => g.teams,
            _ => continue,
        };
        counter.fetch_add(1, Ordering::SeqCst);
    }
}

/// Disabling ClickUp invalidates an in-flight Doc sync (kept separate so the
/// shared signature above stays as other provider lanes extend it).
fn bump_clickup_generation(disabled: &[ModuleId], clickup: &AtomicU64) {
    if disabled.contains(&ModuleId::Clickup) {
        clickup.fetch_add(1, Ordering::SeqCst);
    }
}

#[tauri::command]
pub async fn list_modules(state: State<'_, AppState>) -> Result<ModulesView, CmdError> {
    modules_view(&state)
}

#[tauri::command]
pub async fn set_disabled_screens(
    state: State<'_, AppState>,
    screens: Vec<ScreenId>,
) -> Result<ModulesView, CmdError> {
    set_disabled_screens_logic(&state.pool, &state.screens, screens).await?;
    modules_view(&state)
}

#[tauri::command]
pub async fn set_enabled_modules(
    state: State<'_, AppState>,
    ids: Vec<ModuleId>,
) -> Result<ModulesView, CmdError> {
    let disabled = set_enabled_modules_logic(&state.pool, &state.modules, ids).await?;
    // Invalidate in-flight work of disabled providers so late writes are dropped.
    // No lock here: syncs hold their lock for their whole run, so waiting would
    // block the toggle without stopping the write; remove_module_data takes the lock.
    bump_generations(
        &disabled,
        &Generations {
            linear: &state.workspace_generation,
            github: &state.github_generation,
            slack: &state.slack_generation,
            llm: &state.llm_generation,
            teams: &state.teams_generation,
        },
    );
    if disabled.contains(&ModuleId::Bitbucket) {
        state.bitbucket.generation.fetch_add(1, Ordering::SeqCst);
    }
    bump_clickup_generation(&disabled, &state.clickup_generation);
    modules_view(&state)
}

#[tauri::command]
pub async fn remove_module_data(state: State<'_, AppState>, id: ModuleId) -> Result<(), CmdError> {
    // Wait out any running sync of the owning provider so it cannot repopulate the wipe.
    let _g = match id {
        ModuleId::Linear => Some(state.workspace_lock.lock().await),
        ModuleId::Github | ModuleId::Docs => Some(state.github_lock.lock().await),
        ModuleId::Slack => Some(state.slack_lock.lock().await),
        ModuleId::Teams => Some(state.teams_lock.lock().await),
        ModuleId::Bitbucket => Some(state.bitbucket.lock.lock().await),
        ModuleId::Clickup => Some(state.clickup_lock.lock().await),
        _ => None,
    };
    remove_module_data_locked(&state.pool, state.secret_store.as_ref(), &state.modules, id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::fake::FakeSecretStore;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    fn state(ids: &[ModuleId]) -> ModuleState {
        ModuleState {
            enabled: ids.iter().copied().collect(),
            onboarded: true,
        }
    }

    #[test]
    fn list_reports_missing_tracker() {
        let view = list_modules_logic(&state(&[ModuleId::Reports]));
        let r = view
            .modules
            .iter()
            .find(|m| m.id == ModuleId::Reports)
            .unwrap();
        assert!(r.enabled && !r.available);
        assert_eq!(r.missing, vec![Capability::Tracker]);
    }

    #[tokio::test]
    async fn set_enabled_persists_and_marks_onboarded() {
        let (_d, pool) = pool().await;
        let lock = RwLock::new(ModuleState {
            enabled: [ModuleId::Linear, ModuleId::Github].into_iter().collect(),
            onboarded: false,
        });
        let disabled = set_enabled_modules_logic(&pool, &lock, vec![ModuleId::Linear])
            .await
            .unwrap();
        assert_eq!(disabled, vec![ModuleId::Github]);
        let loaded = modules::load_state(&pool).await.unwrap();
        assert_eq!(loaded, state(&[ModuleId::Linear]));
        assert_eq!(*lock.read().unwrap(), loaded);
    }

    #[tokio::test]
    async fn set_disabled_screens_persists_and_swaps() {
        let (_d, pool) = pool().await;
        let lock = RwLock::new(BTreeSet::new());
        set_disabled_screens_logic(&pool, &lock, vec![ScreenId::Inbox, ScreenId::Inbox])
            .await
            .unwrap();
        let expected = BTreeSet::from([ScreenId::Inbox]);
        assert_eq!(*lock.read().unwrap(), expected);
        assert_eq!(screens::load_disabled(&pool).await.unwrap(), expected);
    }

    #[test]
    fn require_screen_rejects_only_disabled_screens() {
        let off = BTreeSet::from([ScreenId::Inbox]);
        assert!(matches!(
            require_screen_in(&off, ScreenId::Inbox),
            Err(CmdError::ModuleDisabled)
        ));
        assert!(require_screen_in(&off, ScreenId::Issues).is_ok());
    }

    #[test]
    fn view_serializes_disabled_screens_as_view_ids() {
        let mut view = list_modules_logic(&state(&[]));
        view.disabled_screens = vec![ScreenId::Issues, ScreenId::Inbox];
        let json = serde_json::to_value(&view).unwrap();
        assert_eq!(
            json["disabledScreens"],
            serde_json::json!(["list", "inbox"])
        );
    }

    #[test]
    fn missing_linear_key_message_matches_the_frontend() {
        // src/lib/queries.ts LINEAR_KEY_MISSING_MESSAGE matches this text exactly.
        assert_eq!(
            CmdError::NotConfigured.to_string(),
            "No Linear key is configured."
        );
    }

    #[tokio::test]
    async fn removal_waits_for_module_writes_and_rechecks_state() {
        let (_d, pool) = pool().await;
        let store = FakeSecretStore::default();
        store.set("slack_user_token", "x").unwrap();
        let lock = RwLock::new(state(&[]));
        let held = MODULES_WRITE.lock().await;
        let pending = tokio::time::timeout(
            std::time::Duration::from_millis(50),
            remove_module_data_locked(&pool, &store, &lock, ModuleId::Slack),
        )
        .await;
        assert!(pending.is_err(), "removal ran during a module write");
        // The write re-enables Slack; the removal must see that and refuse.
        *lock.write().unwrap() = state(&[ModuleId::Slack]);
        drop(held);
        let r = remove_module_data_locked(&pool, &store, &lock, ModuleId::Slack).await;
        assert!(matches!(r, Err(CmdError::InvalidInput)));
        assert!(store.get("slack_user_token").unwrap().is_some());
    }

    #[tokio::test]
    async fn module_writes_wait_for_the_previous_write() {
        let (_d, pool) = pool().await;
        let lock = RwLock::new(state(&[]));
        let held = MODULES_WRITE.lock().await;
        let pending = tokio::time::timeout(
            std::time::Duration::from_millis(50),
            set_enabled_modules_logic(&pool, &lock, vec![ModuleId::Slack]),
        )
        .await;
        assert!(
            pending.is_err(),
            "write ran while another write held the lock"
        );
        drop(held);
        set_enabled_modules_logic(&pool, &lock, vec![ModuleId::Slack])
            .await
            .unwrap();
        let loaded = modules::load_state(&pool).await.unwrap();
        assert_eq!(*lock.read().unwrap(), loaded);
    }

    #[test]
    fn disabling_github_bumps_only_its_generation() {
        let (l, g, s, m, t) = (
            AtomicU64::new(0),
            AtomicU64::new(0),
            AtomicU64::new(0),
            AtomicU64::new(0),
            AtomicU64::new(0),
        );
        let gens = Generations {
            linear: &l,
            github: &g,
            slack: &s,
            llm: &m,
            teams: &t,
        };
        bump_generations(&[ModuleId::Github, ModuleId::Docs], &gens);
        assert_eq!(g.load(Ordering::SeqCst), 1);
        assert_eq!(
            [&l, &s, &m, &t].map(|c| c.load(Ordering::SeqCst)),
            [0, 0, 0, 0]
        );
        bump_generations(&[ModuleId::Teams], &gens);
        assert_eq!(t.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn remove_teams_wipes_cache_config_and_token() {
        let (_d, pool) = pool().await;
        let store = FakeSecretStore::default();
        crate::teams::save_refresh_token(&store, &"r".repeat(1500)).unwrap();
        store.set("slack_user_token", "x").unwrap();
        db::teams::save_config(&pool, "cid", "organizations")
            .await
            .unwrap();
        db::teams::save_identity(&pool, "me", None).await.unwrap();
        remove_module_data_logic(&pool, &store, &state(&[]), ModuleId::Teams)
            .await
            .unwrap();
        assert_eq!(crate::teams::load_refresh_token(&store).unwrap(), None);
        assert!(store.get("slack_user_token").unwrap().is_some());
        assert_eq!(db::teams::load_config(&pool).await.unwrap(), None);
        assert_eq!(db::teams::load_identity(&pool).await.unwrap(), None);
    }

    #[tokio::test]
    async fn remove_refuses_enabled_module() {
        let (_d, pool) = pool().await;
        let store = FakeSecretStore::default();
        let r =
            remove_module_data_logic(&pool, &store, &state(&[ModuleId::Slack]), ModuleId::Slack)
                .await;
        assert!(matches!(r, Err(CmdError::InvalidInput)));
    }

    #[tokio::test]
    async fn remove_slack_wipes_cache_and_tokens() {
        let (_d, pool) = pool().await;
        let store = FakeSecretStore::default();
        for a in ["slack_user_token", "slack_cookie_d", "linear_api_key"] {
            store.set(a, "x").unwrap();
        }
        sqlx::query(
            "INSERT INTO slack_messages (conversation_id, ts, is_mention, is_unread, created_at)
             VALUES ('C1','1.0',0,0,'now')",
        )
        .execute(&pool)
        .await
        .unwrap();
        remove_module_data_logic(&pool, &store, &state(&[]), ModuleId::Slack)
            .await
            .unwrap();
        assert_eq!(store.get("slack_user_token").unwrap(), None);
        assert_eq!(store.get("slack_cookie_d").unwrap(), None);
        assert!(store.get("linear_api_key").unwrap().is_some());
        let n: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM slack_messages")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n.0, 0);
    }

    #[test]
    fn disabling_clickup_bumps_its_generation() {
        let c = AtomicU64::new(0);
        bump_clickup_generation(&[ModuleId::Github], &c);
        assert_eq!(c.load(Ordering::SeqCst), 0);
        bump_clickup_generation(&[ModuleId::Clickup], &c);
        assert_eq!(c.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn remove_clickup_wipes_its_pages_and_token_but_keeps_doc_entries() {
        let (_d, pool) = pool().await;
        let store = FakeSecretStore::default();
        store.set("clickup_token", "pk").unwrap();
        store.set("github_token", "ghp").unwrap();
        db::docs::insert_clickup_docs_source(&pool, "Handbook", "901/abc-1", "now")
            .await
            .unwrap();
        let id = db::docs::clickup_source_id("901/abc-1");
        db::docs::replace_docs(
            &pool,
            &id,
            &[db::docs::DocFile {
                path: "p1".into(),
                name: "Overview".into(),
                kind: "blob".into(),
                parent_path: "".into(),
                sha: "p1".into(),
                content: Some("# Hi".into()),
            }],
            "now",
            None,
            false,
        )
        .await
        .unwrap();
        remove_module_data_logic(&pool, &store, &state(&[]), ModuleId::Clickup)
            .await
            .unwrap();
        assert_eq!(store.get("clickup_token").unwrap(), None);
        assert!(store.get("github_token").unwrap().is_some());
        assert!(db::docs::list_docs(&pool, &id).await.unwrap().is_empty());
        assert_eq!(db::docs::list_docs_sources(&pool).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn remove_bitbucket_wipes_cache_and_both_accounts() {
        let (_d, pool) = pool().await;
        let store = FakeSecretStore::default();
        for a in ["bitbucket_token", "bitbucket_email", "github_token"] {
            store.set(a, "x").unwrap();
        }
        db::bitbucket::save_login(&pool, "me").await.unwrap();
        remove_module_data_logic(&pool, &store, &state(&[]), ModuleId::Bitbucket)
            .await
            .unwrap();
        assert_eq!(store.get("bitbucket_token").unwrap(), None);
        assert_eq!(store.get("bitbucket_email").unwrap(), None);
        assert!(store.get("github_token").unwrap().is_some());
        assert_eq!(db::bitbucket::load_login(&pool).await.unwrap(), None);
    }

    #[tokio::test]
    async fn remove_llm_clears_settings_and_key() {
        let (_d, pool) = pool().await;
        let store = FakeSecretStore::default();
        store.set("llm_api_key", "x").unwrap();
        db::save_setting(&pool, "llm_base_url", "u").await.unwrap();
        db::save_setting(&pool, "llm_model", "m").await.unwrap();
        remove_module_data_logic(&pool, &store, &state(&[]), ModuleId::Llm)
            .await
            .unwrap();
        assert_eq!(store.get("llm_api_key").unwrap(), None);
        assert_eq!(db::load_setting(&pool, "llm_base_url").await.unwrap(), None);
        assert_eq!(db::load_setting(&pool, "llm_model").await.unwrap(), None);
    }
}
