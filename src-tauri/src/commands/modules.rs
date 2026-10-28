//! Module management commands: list, enable/disable, and remove a module's data.

use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

use super::reports::{LLM_BASE_URL_KEY, LLM_MODEL_KEY};
use super::{AppState, CmdError, GITHUB_TOKEN_ACCOUNT, LINEAR_KEY_ACCOUNT, LLM_API_KEY_ACCOUNT};
use crate::db;
use crate::modules::{self, Capability, ModuleId, ModuleKind, ModuleState};
use crate::secrets::SecretStore;

const SLACK_ACCOUNTS: [&str; 2] = ["slack_user_token", "slack_cookie_d"];

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
    }
}

/// Persist the new enabled set (marking the app onboarded) and return the
/// modules that were enabled before and are not any more.
pub async fn set_enabled_modules_logic(
    pool: &SqlitePool,
    modules: &RwLock<ModuleState>,
    ids: Vec<ModuleId>,
) -> Result<Vec<ModuleId>, CmdError> {
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
        // The only copy of the user's tasks; the command wrapper snapshots them first.
        ModuleId::LocalTasks => {
            crate::local_tasks::db::wipe(pool)
                .await
                .map_err(|_| CmdError::Internal)?;
        }
        // Nothing persisted: in-memory state only.
        ModuleId::Reports | ModuleId::LinkPreviews => {}
    }
    Ok(())
}

/// Bump the generation counter of every disabled provider.
fn bump_generations(
    disabled: &[ModuleId],
    linear: &AtomicU64,
    github: &AtomicU64,
    slack: &AtomicU64,
    llm: &AtomicU64,
) {
    for id in disabled {
        let counter = match id {
            ModuleId::Linear => linear,
            ModuleId::Github => github,
            ModuleId::Slack => slack,
            ModuleId::Llm => llm,
            _ => continue,
        };
        counter.fetch_add(1, Ordering::SeqCst);
    }
}

#[tauri::command]
pub async fn list_modules(state: State<'_, AppState>) -> Result<ModulesView, CmdError> {
    let guard = state.modules.read().map_err(|_| CmdError::Internal)?;
    Ok(list_modules_logic(&guard))
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
        &state.workspace_generation,
        &state.github_generation,
        &state.slack_generation,
        &state.llm_generation,
    );
    let guard = state.modules.read().map_err(|_| CmdError::Internal)?;
    Ok(list_modules_logic(&guard))
}

#[tauri::command]
pub async fn remove_module_data(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: ModuleId,
) -> Result<(), CmdError> {
    // Wait out any running sync of the owning provider so it cannot repopulate the wipe.
    let _g = match id {
        ModuleId::Linear => Some(state.workspace_lock.lock().await),
        ModuleId::Github | ModuleId::Docs => Some(state.github_lock.lock().await),
        ModuleId::Slack => Some(state.slack_lock.lock().await),
        _ => None,
    };
    let snapshot = state
        .modules
        .read()
        .map_err(|_| CmdError::Internal)?
        .clone();
    // Local tasks exist nowhere else: keep a final snapshot in the backups folder.
    if id == ModuleId::LocalTasks && !snapshot.enabled.contains(&id) {
        let dir = super::local_tasks::backups_dir(&app)?;
        crate::local_tasks::backup::write_safety(&state.pool, &dir, "before-removal").await?;
    }
    remove_module_data_logic(&state.pool, state.secret_store.as_ref(), &snapshot, id).await
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

    #[test]
    fn disabling_github_bumps_only_its_generation() {
        let (l, g, s, m) = (
            AtomicU64::new(0),
            AtomicU64::new(0),
            AtomicU64::new(0),
            AtomicU64::new(0),
        );
        bump_generations(&[ModuleId::Github, ModuleId::Docs], &l, &g, &s, &m);
        assert_eq!(g.load(Ordering::SeqCst), 1);
        assert_eq!([&l, &s, &m].map(|c| c.load(Ordering::SeqCst)), [0, 0, 0]);
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

    #[tokio::test]
    async fn remove_local_tasks_only_when_off_and_wipes_everything() {
        let (_d, pool) = pool().await;
        let store = FakeSecretStore::default();
        crate::local_tasks::db::ensure_seeded(&pool).await.unwrap();
        assert!(remove_module_data_logic(
            &pool,
            &store,
            &state(&[ModuleId::LocalTasks]),
            ModuleId::LocalTasks
        )
        .await
        .is_err());
        remove_module_data_logic(&pool, &store, &state(&[]), ModuleId::LocalTasks)
            .await
            .unwrap();
        let tree = crate::local_tasks::db::load_tree(&pool).await.unwrap();
        assert!(tree.spaces.is_empty() && tree.statuses.is_empty());
    }
}
