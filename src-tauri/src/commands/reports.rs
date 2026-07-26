//! Report-generator commands: LLM endpoint config (base URL + model in the
//! settings table, optional API key in the keychain) and report generation.
//! The endpoint URL/model aren't secrets; the API key never returns to TS.

use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use super::{AppState, CmdError, LLM_API_KEY_ACCOUNT};
use crate::db;
use crate::generators::facts::{self, WindowArgs};
use crate::generators::llm::{ChatRequest, LlmClient, LlmError};
use crate::secrets::SecretStore;

const LLM_BASE_URL_KEY: &str = "llm_base_url";
const LLM_MODEL_KEY: &str = "llm_model";

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfig {
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReportResult {
    /// Deterministic markdown facts — always present, the offline fallback.
    pub fact_sheet: String,
    /// The LLM's prose (think-spans stripped); None when no endpoint is
    /// configured or the LLM pass failed.
    pub llm_text: Option<String>,
    /// Sanitized reason the LLM pass was skipped mid-flight, if it failed.
    pub llm_error: Option<String>,
    pub model: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TokenEvent {
    gen_id: u64,
    token: String,
}

async fn secret_get(
    store: &Arc<dyn SecretStore>,
    account: &'static str,
) -> Result<Option<String>, CmdError> {
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.get(account))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)
}

/// Empty-string settings count as unset (settings rows are never deleted).
async fn load_setting_nonempty(pool: &SqlitePool, key: &str) -> Result<Option<String>, CmdError> {
    Ok(db::load_setting(pool, key)
        .await
        .map_err(|_| CmdError::Internal)?
        .filter(|v| !v.trim().is_empty()))
}

pub async fn get_llm_config_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
) -> Result<Option<LlmConfig>, CmdError> {
    let Some(base_url) = load_setting_nonempty(pool, LLM_BASE_URL_KEY).await? else {
        return Ok(None);
    };
    let model = load_setting_nonempty(pool, LLM_MODEL_KEY)
        .await?
        .unwrap_or_default();
    let has_api_key = secret_get(&store, LLM_API_KEY_ACCOUNT).await?.is_some();
    Ok(Some(LlmConfig {
        base_url,
        model,
        has_api_key,
    }))
}

/// Save endpoint + model; `api_key: Some(key)` also stores the key (pasted
/// once, never echoed back), `None` leaves any stored key untouched.
pub async fn set_llm_config_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    base_url: String,
    model: String,
    api_key: Option<String>,
) -> Result<LlmConfig, CmdError> {
    let base_url = base_url.trim().to_string();
    let model = model.trim().to_string();
    if model.is_empty() || !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
        return Err(CmdError::InvalidInput);
    }
    db::save_setting(pool, LLM_BASE_URL_KEY, &base_url)
        .await
        .map_err(|_| CmdError::Internal)?;
    db::save_setting(pool, LLM_MODEL_KEY, &model)
        .await
        .map_err(|_| CmdError::Internal)?;
    if let Some(key) = api_key
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
    {
        let s = store.clone();
        tokio::task::spawn_blocking(move || s.set(LLM_API_KEY_ACCOUNT, &key))
            .await
            .map_err(|_| CmdError::Internal)?
            .map_err(|_| CmdError::SecretStore)?;
    }
    let has_api_key = secret_get(&store, LLM_API_KEY_ACCOUNT).await?.is_some();
    Ok(LlmConfig {
        base_url,
        model,
        has_api_key,
    })
}

pub async fn clear_llm_config_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
) -> Result<(), CmdError> {
    db::save_setting(pool, LLM_BASE_URL_KEY, "")
        .await
        .map_err(|_| CmdError::Internal)?;
    db::save_setting(pool, LLM_MODEL_KEY, "")
        .await
        .map_err(|_| CmdError::Internal)?;
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.delete(LLM_API_KEY_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

fn llm_error_text(e: LlmError) -> String {
    match e {
        LlmError::Network => "Couldn't reach the AI endpoint.".to_string(),
        LlmError::Api => "The AI endpoint rejected the request.".to_string(),
        LlmError::Malformed => "The AI endpoint returned an unexpected response.".to_string(),
        LlmError::Canceled => "Superseded by a newer generation.".to_string(),
    }
}

#[tauri::command]
pub async fn get_llm_config(state: State<'_, AppState>) -> Result<Option<LlmConfig>, CmdError> {
    get_llm_config_logic(state.secret_store.clone(), &state.pool).await
}

#[tauri::command]
pub async fn set_llm_config(
    state: State<'_, AppState>,
    base_url: String,
    model: String,
    api_key: Option<String>,
) -> Result<LlmConfig, CmdError> {
    set_llm_config_logic(
        state.secret_store.clone(),
        &state.pool,
        base_url,
        model,
        api_key,
    )
    .await
}

#[tauri::command]
pub async fn clear_llm_config(state: State<'_, AppState>) -> Result<(), CmdError> {
    clear_llm_config_logic(state.secret_store.clone(), &state.pool).await
}

/// Settings "Test" probe: hit `{base}/v1/models`, return the model ids.
#[tauri::command]
pub async fn test_llm_connection(state: State<'_, AppState>) -> Result<Vec<String>, CmdError> {
    let cfg = get_llm_config_logic(state.secret_store.clone(), &state.pool)
        .await?
        .ok_or(CmdError::LlmNotConfigured)?;
    let api_key = secret_get(&state.secret_store, LLM_API_KEY_ACCOUNT).await?;
    let client = LlmClient::new().map_err(|_| CmdError::Internal)?;
    client
        .list_models(&cfg.base_url, api_key.as_deref())
        .await
        .map_err(|e| match e {
            LlmError::Network => CmdError::Network,
            _ => CmdError::LlmApi,
        })
}

/// Assemble facts from the cache, then (when an endpoint is configured) stream
/// the LLM's prose to the UI as `report:token` events. The facts always come
/// back even if the LLM pass fails — the report degrades, never errors away.
#[tauri::command]
pub async fn generate_report(
    app: AppHandle,
    state: State<'_, AppState>,
    args: WindowArgs,
    gen_id: u64,
) -> Result<ReportResult, CmdError> {
    let (viewer_id, viewer_name) = db::load_me(&state.pool)
        .await
        .map_err(|_| CmdError::Internal)?
        .ok_or(CmdError::NotConfigured)?;
    let f = facts::assemble(&state.pool, &viewer_id, &viewer_name, args)
        .await
        .map_err(|_| CmdError::Internal)?;
    let fact_sheet = facts::render_fact_sheet(&f);

    // Claim the generation slot: any newer generate_report supersedes us.
    state.llm_generation.store(gen_id, Ordering::SeqCst);

    let cfg = get_llm_config_logic(state.secret_store.clone(), &state.pool).await?;
    let Some(cfg) = cfg else {
        return Ok(ReportResult {
            fact_sheet,
            llm_text: None,
            llm_error: None,
            model: None,
        });
    };
    let api_key = secret_get(&state.secret_store, LLM_API_KEY_ACCOUNT).await?;
    let (system, user) = facts::build_prompt(&f, &fact_sheet);

    let client = LlmClient::new().map_err(|_| CmdError::Internal)?;
    let generation = &state.llm_generation;
    let result = client
        .stream_chat(
            ChatRequest {
                base_url: &cfg.base_url,
                api_key: api_key.as_deref(),
                model: &cfg.model,
                system: &system,
                user: &user,
            },
            || generation.load(Ordering::SeqCst) == gen_id,
            |token| {
                let _ = app.emit(
                    "report:token",
                    TokenEvent {
                        gen_id,
                        token: token.to_string(),
                    },
                );
            },
        )
        .await;

    let (llm_text, llm_error) = match result {
        Ok(text) => (Some(text), None),
        Err(e) => (None, Some(llm_error_text(e))),
    };
    Ok(ReportResult {
        fact_sheet,
        llm_text,
        llm_error,
        model: Some(cfg.model),
    })
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

    #[tokio::test]
    async fn config_roundtrip_and_key_flag() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());

        assert_eq!(
            get_llm_config_logic(store.clone(), &pool).await.unwrap(),
            None
        );

        let saved = set_llm_config_logic(
            store.clone(),
            &pool,
            "http://localhost:11434".into(),
            "phi4-mini-reasoning:latest".into(),
            None,
        )
        .await
        .unwrap();
        assert!(!saved.has_api_key);

        let got = get_llm_config_logic(store.clone(), &pool)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(got.base_url, "http://localhost:11434");
        assert_eq!(got.model, "phi4-mini-reasoning:latest");

        // Second save WITH a key sets the flag; the key itself is never returned.
        let saved = set_llm_config_logic(
            store.clone(),
            &pool,
            "https://api.openai.com".into(),
            "gpt-4o-mini".into(),
            Some("sk-secret".into()),
        )
        .await
        .unwrap();
        assert!(saved.has_api_key);
        // Re-save WITHOUT a key keeps the stored key.
        let saved = set_llm_config_logic(
            store.clone(),
            &pool,
            "https://api.openai.com".into(),
            "gpt-4o-mini".into(),
            None,
        )
        .await
        .unwrap();
        assert!(saved.has_api_key);
    }

    #[tokio::test]
    async fn set_rejects_bad_input() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        for (url, model) in [
            ("localhost:11434", "m"), // no scheme
            ("http://ok", ""),        // empty model
            ("", "m"),
        ] {
            let r =
                set_llm_config_logic(store.clone(), &pool, url.into(), model.into(), None).await;
            assert!(matches!(r, Err(CmdError::InvalidInput)), "{url} {model}");
        }
        assert_eq!(get_llm_config_logic(store, &pool).await.unwrap(), None);
    }

    #[tokio::test]
    async fn clear_wipes_config_and_key() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        set_llm_config_logic(
            store.clone(),
            &pool,
            "http://localhost:11434".into(),
            "phi4".into(),
            Some("k".into()),
        )
        .await
        .unwrap();

        clear_llm_config_logic(store.clone(), &pool).await.unwrap();
        assert_eq!(
            get_llm_config_logic(store.clone(), &pool).await.unwrap(),
            None
        );
        assert!(store.get(LLM_API_KEY_ACCOUNT).unwrap().is_none());
    }
}
