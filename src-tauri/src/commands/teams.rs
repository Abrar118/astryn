//! Microsoft Teams commands: device-code sign-in, status, sync, cache reads.
//! Wrappers stay thin; the `_logic` fns take injected network closures.

use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::State;

use super::{AppState, CmdError};
use crate::db::teams as tdb;
use crate::teams::catchup::{self, Me, ParsedChat, ParsedMessage};
use crate::teams::oauth::{self, DeviceCode, TokenPoll, TokenSet};
use crate::teams::{TeamsCredentialProvider, TeamsError};

/// Most recently active chats scanned per sync (4 pages of 50).
const MAX_CHAT_PAGES: usize = 4;

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum TeamsStatus {
    NotConfigured,
    Unverified,
    Connected {
        #[serde(rename = "userName")]
        user_name: String,
    },
}

/// What the user needs to finish the device-code sign-in. The secret
/// `device_code` stays in Rust.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamsDeviceCode {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: i64,
    pub interval: i64,
    pub message: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum TeamsSignInPoll {
    Pending {
        interval: i64,
    },
    Connected {
        #[serde(rename = "userName")]
        user_name: String,
    },
}

/// An in-progress device-code sign-in, held in memory only.
#[derive(Clone, Debug)]
pub struct PendingSignIn {
    pub client_id: String,
    pub tenant: String,
    pub device_code: String,
    pub interval: i64,
    pub expires_at: Instant,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TeamsCatchup {
    pub conversations: Vec<tdb::ChatConversationRow>,
    pub mentions: Vec<tdb::ChatMessageRow>,
    /// Teams chats have no threads; kept so the payload matches the chat board.
    pub threads: Vec<serde_json::Value>,
    pub last_synced_at: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TeamsSyncSummary {
    pub synced: bool,
    pub conversation_count: i64,
    pub unread_total: i64,
}

pub fn map_teams_err(e: TeamsError) -> CmdError {
    match e {
        TeamsError::Network | TeamsError::Server => CmdError::TeamsUnreachable,
        TeamsError::Auth => CmdError::TeamsAuth,
        TeamsError::Forbidden => CmdError::TeamsForbidden,
        TeamsError::RateLimited(_) => CmdError::RateLimited,
        TeamsError::Malformed | TeamsError::Api(_) => CmdError::TeamsApi,
    }
}

pub fn compute_status(has_token: bool, identity: Option<tdb::TeamsIdentity>) -> TeamsStatus {
    match (has_token, identity) {
        (false, _) => TeamsStatus::NotConfigured,
        (true, Some(id)) => TeamsStatus::Connected {
            user_name: id.user_name.unwrap_or(id.user_id),
        },
        (true, None) => TeamsStatus::Unverified,
    }
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, crate::secrets::SecretError> + Send + 'static,
) -> Result<T, CmdError> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)
}

/// Validate the user's app registration and turn a device-code response into
/// the pending state (kept in Rust) plus the part shown to the user.
pub async fn start_sign_in_logic<F, Fut>(
    client_id: String,
    tenant: Option<String>,
    now: Instant,
    request: F,
) -> Result<(PendingSignIn, TeamsDeviceCode), CmdError>
where
    F: FnOnce(String, String) -> Fut,
    Fut: std::future::Future<Output = Result<DeviceCode, TeamsError>>,
{
    let client_id = client_id.trim().to_string();
    if !oauth::valid_client_id(&client_id) {
        return Err(CmdError::TeamsInvalidConfig);
    }
    let tenant = oauth::normalize_tenant(tenant.as_deref()).ok_or(CmdError::TeamsInvalidConfig)?;
    let code = request(tenant.clone(), client_id.clone())
        .await
        .map_err(|e| match e {
            // The identity platform rejects an unknown client id / tenant.
            TeamsError::Auth | TeamsError::Api(_) => CmdError::TeamsInvalidConfig,
            other => map_teams_err(other),
        })?;
    let pending = PendingSignIn {
        client_id,
        tenant,
        device_code: code.device_code,
        interval: code.interval,
        expires_at: now + Duration::from_secs(code.expires_in.max(0) as u64),
    };
    let shown = TeamsDeviceCode {
        user_code: code.user_code,
        verification_uri: code.verification_uri,
        expires_in: code.expires_in,
        interval: code.interval,
        message: code.message,
    };
    Ok((pending, shown))
}

/// What to do after one token poll.
#[derive(Debug, PartialEq)]
pub enum PollStep {
    /// Keep polling after this many seconds.
    Wait(i64),
    Granted(TokenSet),
    /// Declined, expired, or otherwise dead: forget the pending sign-in.
    Fail,
}

pub fn poll_step(pending: &PendingSignIn, now: Instant, outcome: TokenPoll) -> PollStep {
    if now >= pending.expires_at {
        return PollStep::Fail;
    }
    match outcome {
        TokenPoll::Pending => PollStep::Wait(pending.interval),
        // RFC 8628: slow_down adds 5 seconds to the interval.
        TokenPoll::SlowDown => PollStep::Wait(pending.interval + 5),
        TokenPoll::Granted(t) => PollStep::Granted(t),
        TokenPoll::Declined | TokenPoll::Expired | TokenPoll::Failed => PollStep::Fail,
    }
}

/// A poll step that still owns the pending sign-in.
#[derive(Debug, PartialEq)]
pub enum Committed {
    Wait(i64),
    Granted(TokenSet),
}

/// Apply a poll result to the pending slot only if the slot still holds the
/// device code that was polled. A poll that raced a cancel (slot empty) or a
/// newer sign-in (different code) changes nothing and reports failure.
pub fn commit_poll(
    slot: &mut Option<PendingSignIn>,
    device_code: &str,
    step: PollStep,
) -> Result<Committed, CmdError> {
    let current = match slot.as_mut() {
        Some(p) if p.device_code == device_code => p,
        _ => return Err(CmdError::TeamsSignInFailed),
    };
    match step {
        PollStep::Wait(interval) => {
            current.interval = interval;
            Ok(Committed::Wait(interval))
        }
        PollStep::Fail => {
            *slot = None;
            Err(CmdError::TeamsSignInFailed)
        }
        PollStep::Granted(tokens) => {
            *slot = None;
            Ok(Committed::Granted(tokens))
        }
    }
}

/// A granted sign-in is an account switch: wipe Teams state and bump the
/// generation BEFORE storing the new grant (fail-safe ordering), then verify
/// with `/me` and cache the identity.
#[allow(clippy::too_many_arguments)]
pub async fn finish_sign_in_logic<F, Fut>(
    creds: Arc<dyn TeamsCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    client_id: &str,
    tenant: &str,
    tokens: TokenSet,
    fetch_me: F,
) -> Result<String, CmdError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<Me, TeamsError>>,
{
    let refresh = tokens.refresh_token.ok_or(CmdError::TeamsSignInFailed)?;
    tdb::wipe_teams_cache(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    tdb::save_config(pool, client_id, tenant)
        .await
        .map_err(|_| CmdError::Internal)?;
    let c = creds.clone();
    blocking(move || c.save_refresh_token(&refresh)).await?;
    let me = fetch_me(tokens.access_token).await.map_err(map_teams_err)?;
    tdb::save_identity(pool, &me.id, me.display_name.as_deref())
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(me.display_name.unwrap_or(me.id))
}

/// Redeem the stored refresh token for an access token, storing the rotated
/// refresh token. The access token is never persisted.
pub async fn authorize<F, Fut>(
    creds: &Arc<dyn TeamsCredentialProvider>,
    pool: &SqlitePool,
    refresh: F,
) -> Result<String, CmdError>
where
    F: FnOnce(tdb::TeamsConfig, String) -> Fut,
    Fut: std::future::Future<Output = Result<TokenSet, TeamsError>>,
{
    let config = tdb::load_config(pool)
        .await
        .map_err(|_| CmdError::Internal)?
        .ok_or(CmdError::TeamsNotConfigured)?;
    let c = creds.clone();
    let stored = blocking(move || c.refresh_token())
        .await?
        .ok_or(CmdError::TeamsNotConfigured)?;
    let tokens = refresh(config, stored).await.map_err(map_teams_err)?;
    if let Some(rotated) = tokens.refresh_token {
        let c = creds.clone();
        blocking(move || c.save_refresh_token(&rotated)).await?;
    }
    Ok(tokens.access_token)
}

pub async fn clear_account_logic(
    creds: Arc<dyn TeamsCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
) -> Result<(), CmdError> {
    tdb::wipe_teams_cache(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    blocking(move || creds.clear()).await
}

pub async fn get_status_logic(
    creds: Arc<dyn TeamsCredentialProvider>,
    pool: &SqlitePool,
) -> Result<TeamsStatus, CmdError> {
    let has_token = blocking(move || creds.refresh_token()).await?.is_some();
    let identity = tdb::load_identity(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(compute_status(has_token, identity))
}

pub async fn test_connection_logic<R, RF, M, MF>(
    creds: Arc<dyn TeamsCredentialProvider>,
    pool: &SqlitePool,
    refresh: R,
    fetch_me: M,
) -> Result<TeamsStatus, CmdError>
where
    R: FnOnce(tdb::TeamsConfig, String) -> RF,
    RF: std::future::Future<Output = Result<TokenSet, TeamsError>>,
    M: FnOnce(String) -> MF,
    MF: std::future::Future<Output = Result<Me, TeamsError>>,
{
    let access = authorize(&creds, pool, refresh).await?;
    let me = fetch_me(access).await.map_err(map_teams_err)?;
    tdb::save_identity(pool, &me.id, me.display_name.as_deref())
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(TeamsStatus::Connected {
        user_name: me.display_name.unwrap_or(me.id),
    })
}

/// Fetch, compute, and commit the catch-up in one transaction. Any fetch
/// failure leaves the prior cache untouched; a generation change (account
/// switch or module disabled mid-flight) discards the result.
#[allow(clippy::too_many_arguments)]
pub async fn sync_logic<R, RF, L, LF, M, MF>(
    creds: Arc<dyn TeamsCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    now: String,
    refresh: R,
    list_chats: L,
    fetch_messages: M,
) -> Result<TeamsSyncSummary, CmdError>
where
    R: FnOnce(tdb::TeamsConfig, String) -> RF,
    RF: std::future::Future<Output = Result<TokenSet, TeamsError>>,
    L: FnOnce(String) -> LF,
    LF: std::future::Future<Output = Result<Vec<ParsedChat>, TeamsError>>,
    M: Fn(String, String) -> MF,
    MF: std::future::Future<Output = Result<Vec<ParsedMessage>, TeamsError>>,
{
    let gen0 = generation.load(Ordering::SeqCst);
    let viewer_id = tdb::load_identity(pool)
        .await
        .map_err(|_| CmdError::Internal)?
        .map(|i| i.user_id)
        .ok_or(CmdError::TeamsNotConfigured)?;
    let access = authorize(&creds, pool, refresh).await?;
    let chats = list_chats(access.clone()).await.map_err(map_teams_err)?;

    let mut chat_rows = Vec::new();
    let mut msg_rows = Vec::new();
    let mut unread_total = 0i64;
    for chat in chats
        .iter()
        .filter(|c| catchup::chat_has_unread(c, &viewer_id))
    {
        let messages = match fetch_messages(access.clone(), chat.id.clone()).await {
            Ok(m) => m,
            // A chat the viewer can't read (403/404, odd payload) is skipped so
            // the rest still sync. Network, auth, rate-limit and 5xx errors hit
            // every chat alike, so they still fail the sync and keep the prior cache.
            Err(TeamsError::Forbidden | TeamsError::Api(_) | TeamsError::Malformed) => continue,
            Err(e) => return Err(map_teams_err(e)),
        };
        let unread = catchup::unread_messages(&messages, chat.last_read.as_deref(), &viewer_id);
        if unread.is_empty() {
            continue;
        }
        let latest = unread
            .iter()
            .max_by_key(|m| catchup::parse_time(&m.created_at))
            .expect("non-empty");
        let mut has_mention = false;
        for m in &unread {
            let is_mention = catchup::is_mention(m, &viewer_id);
            has_mention |= is_mention;
            msg_rows.push(tdb::MessageInsert {
                chat_id: chat.id.clone(),
                id: m.id.clone(),
                user_id: m.user_id.clone(),
                user_name: m.user_name.clone(),
                text: Some(m.text.clone()),
                is_mention,
                linear_identifier: crate::issue_ref::extract_linear_identifier(&m.text, ""),
                created_at: m.created_at.clone(),
            });
        }
        unread_total += unread.len() as i64;
        chat_rows.push(tdb::ChatInsert {
            id: chat.id.clone(),
            kind: chat.kind.to_string(),
            name: catchup::chat_name(chat, &viewer_id),
            unread_count: unread.len() as i64,
            has_mention,
            latest_at: Some(latest.created_at.clone()),
            latest_message_id: Some(latest.id.clone()),
            latest_snippet: Some(catchup::snippet(&latest.text)),
            web_url: chat.web_url.clone(),
        });
    }

    if generation.load(Ordering::SeqCst) != gen0 {
        return Err(CmdError::WorkspaceChanged);
    }
    tdb::replace_catchup(pool, &chat_rows, &msg_rows, &now)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(TeamsSyncSummary {
        synced: true,
        conversation_count: chat_rows.len() as i64,
        unread_total,
    })
}

pub async fn get_catchup_logic(
    pool: &SqlitePool,
    include_tracker: bool,
) -> Result<TeamsCatchup, CmdError> {
    let e = |_| CmdError::Internal;
    Ok(TeamsCatchup {
        conversations: tdb::list_conversations(pool).await.map_err(e)?,
        mentions: tdb::list_mentions(pool, include_tracker).await.map_err(e)?,
        threads: Vec::new(),
        last_synced_at: crate::db::load_setting(pool, tdb::TEAMS_SYNCED_AT_KEY)
            .await
            .map_err(e)?,
    })
}

const TEAMS_WEB: &str = "https://teams.microsoft.com/";

/// An https Teams link for a chat (its Graph `webUrl`) or one message in it.
/// Only `https://teams.microsoft.com/` URLs are ever returned.
pub fn open_link_logic(web_url: Option<&str>, chat_id: &str, message_id: Option<&str>) -> String {
    let mut url = reqwest::Url::parse(TEAMS_WEB).expect("valid base");
    match message_id.filter(|m| !m.is_empty()) {
        Some(mid) => {
            url.path_segments_mut()
                .expect("base has a path")
                .clear()
                .extend(["l", "message", chat_id, mid]);
            url.set_query(Some("context=%7B%22contextType%22%3A%22chat%22%7D"));
            url.to_string()
        }
        None => match web_url.filter(|w| w.starts_with(TEAMS_WEB)) {
            Some(w) => w.to_string(),
            None => {
                url.path_segments_mut()
                    .expect("base has a path")
                    .clear()
                    .extend(["l", "chat", chat_id, "0"]);
                url.to_string()
            }
        },
    }
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

// ---- Live Graph fetchers -------------------------------------------------

async fn fetch_me(client: &crate::teams::GraphClient, access: String) -> Result<Me, TeamsError> {
    let url = client.graph_url(&["me"], "$select=id,displayName");
    catchup::parse_me(&client.get(&access, &url).await?)
}

async fn list_chats(
    client: &crate::teams::GraphClient,
    access: String,
) -> Result<Vec<ParsedChat>, TeamsError> {
    let mut url = client.graph_url(
        &["me", "chats"],
        "$expand=members,lastMessagePreview&$orderby=lastMessagePreview/createdDateTime%20desc&$top=50",
    );
    let mut out = Vec::new();
    for _ in 0..MAX_CHAT_PAGES {
        let (mut page, next) = catchup::parse_chats(&client.get(&access, &url).await?)?;
        out.append(&mut page);
        match next {
            // `get` refuses any link that leaves the Graph origin.
            Some(n) if n != url => url = n,
            _ => break,
        }
    }
    Ok(out)
}

async fn fetch_messages(
    client: &crate::teams::GraphClient,
    access: String,
    chat_id: String,
) -> Result<Vec<ParsedMessage>, TeamsError> {
    let url = client.graph_url(
        &["chats", &chat_id, "messages"],
        "$top=50&$orderby=createdDateTime%20desc",
    );
    catchup::parse_messages(&client.get(&access, &url).await?)
}

fn refresher(
    client: crate::teams::GraphClient,
) -> impl FnOnce(
    tdb::TeamsConfig,
    String,
) -> std::pin::Pin<
    Box<dyn std::future::Future<Output = Result<TokenSet, TeamsError>> + Send>,
> {
    move |cfg, rt| Box::pin(async move { client.refresh(&cfg.tenant, &cfg.client_id, &rt).await })
}

// ---- Tauri commands ------------------------------------------------------

#[tauri::command]
pub async fn start_teams_sign_in(
    state: State<'_, AppState>,
    client_id: String,
    tenant: Option<String>,
) -> Result<TeamsDeviceCode, CmdError> {
    state.require(crate::modules::ModuleId::Teams)?;
    let client = state.teams.clone();
    let (pending, shown) =
        start_sign_in_logic(client_id, tenant, Instant::now(), |t, c| async move {
            client.request_device_code(&t, &c).await
        })
        .await?;
    *state.teams_pending.lock().await = Some(pending);
    Ok(shown)
}

#[tauri::command]
pub async fn poll_teams_sign_in(state: State<'_, AppState>) -> Result<TeamsSignInPoll, CmdError> {
    state.require(crate::modules::ModuleId::Teams)?;
    let _g = state.teams_lock.lock().await;
    let pending = state
        .teams_pending
        .lock()
        .await
        .clone()
        .ok_or(CmdError::TeamsSignInFailed)?;
    let outcome = if Instant::now() >= pending.expires_at {
        TokenPoll::Expired
    } else {
        state
            .teams
            .poll_device_token(&pending.tenant, &pending.client_id, &pending.device_code)
            .await
            .map_err(map_teams_err)?
    };
    let step = poll_step(&pending, Instant::now(), outcome);
    // Cancel and a newer start may have changed the slot while the request was
    // in flight; only commit if this poll still owns it.
    let committed = commit_poll(
        &mut *state.teams_pending.lock().await,
        &pending.device_code,
        step,
    )?;
    match committed {
        Committed::Wait(interval) => Ok(TeamsSignInPoll::Pending { interval }),
        Committed::Granted(tokens) => {
            let client = state.teams.clone();
            let user_name = finish_sign_in_logic(
                state.teams_credentials.clone(),
                &state.pool,
                &state.teams_generation,
                &pending.client_id,
                &pending.tenant,
                tokens,
                |access| async move { fetch_me(&client, access).await },
            )
            .await?;
            Ok(TeamsSignInPoll::Connected { user_name })
        }
    }
}

#[tauri::command]
pub async fn cancel_teams_sign_in(state: State<'_, AppState>) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::Teams)?;
    *state.teams_pending.lock().await = None;
    Ok(())
}

#[tauri::command]
pub async fn clear_teams_account(state: State<'_, AppState>) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::Teams)?;
    let _g = state.teams_lock.lock().await;
    *state.teams_pending.lock().await = None;
    clear_account_logic(
        state.teams_credentials.clone(),
        &state.pool,
        &state.teams_generation,
    )
    .await
}

#[tauri::command]
pub async fn get_teams_status(state: State<'_, AppState>) -> Result<TeamsStatus, CmdError> {
    get_status_logic(state.teams_credentials.clone(), &state.pool).await
}

#[tauri::command]
pub async fn test_teams_connection(state: State<'_, AppState>) -> Result<TeamsStatus, CmdError> {
    state.require(crate::modules::ModuleId::Teams)?;
    let _g = state.teams_lock.lock().await;
    let client = state.teams.clone();
    test_connection_logic(
        state.teams_credentials.clone(),
        &state.pool,
        refresher(state.teams.clone()),
        |access| async move { fetch_me(&client, access).await },
    )
    .await
}

#[tauri::command]
pub async fn sync_teams_catchup(state: State<'_, AppState>) -> Result<TeamsSyncSummary, CmdError> {
    state.require(crate::modules::ModuleId::Teams)?;
    let _g = state.teams_lock.lock().await;
    let list_client = state.teams.clone();
    let msg_client = state.teams.clone();
    sync_logic(
        state.teams_credentials.clone(),
        &state.pool,
        &state.teams_generation,
        now_iso(),
        refresher(state.teams.clone()),
        |access| async move { list_chats(&list_client, access).await },
        move |access, chat_id| {
            let c = msg_client.clone();
            async move { fetch_messages(&c, access, chat_id).await }
        },
    )
    .await
}

#[tauri::command]
pub async fn get_teams_catchup(state: State<'_, AppState>) -> Result<TeamsCatchup, CmdError> {
    state.require(crate::modules::ModuleId::Teams)?;
    let include_tracker = state.capability(crate::modules::Capability::Tracker);
    get_catchup_logic(&state.pool, include_tracker).await
}

#[tauri::command]
pub async fn get_teams_chat_messages(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<tdb::ChatMessageRow>, CmdError> {
    state.require(crate::modules::ModuleId::Teams)?;
    let include_tracker = state.capability(crate::modules::Capability::Tracker);
    tdb::list_chat_messages(&state.pool, &conversation_id, include_tracker)
        .await
        .map_err(|_| CmdError::Internal)
}

#[tauri::command]
pub async fn teams_open_link(
    state: State<'_, AppState>,
    conversation_id: String,
    message_id: Option<String>,
) -> Result<String, CmdError> {
    state.require(crate::modules::ModuleId::Teams)?;
    let web_url = tdb::chat_web_url(&state.pool, &conversation_id)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(open_link_logic(
        web_url.as_deref(),
        &conversation_id,
        message_id.as_deref(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::teams::catchup::{ParsedMember, Preview};
    use crate::teams::fake::FakeTeamsCreds;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    const CID: &str = "00001111-aaaa-2222-bbbb-3333cccc4444";

    fn code() -> DeviceCode {
        DeviceCode {
            device_code: "secret-device-code".into(),
            user_code: "ABCD1234".into(),
            verification_uri: "https://microsoft.com/devicelogin".into(),
            expires_in: 900,
            interval: 5,
            message: None,
        }
    }

    fn tokens(rt: Option<&str>) -> TokenSet {
        TokenSet {
            access_token: "at".into(),
            refresh_token: rt.map(str::to_string),
        }
    }

    fn me() -> Me {
        Me {
            id: "me-1".into(),
            display_name: Some("Ada".into()),
        }
    }

    #[tokio::test]
    async fn start_validates_and_hides_the_device_code() {
        let now = Instant::now();
        let (pending, shown) =
            start_sign_in_logic(format!(" {CID} "), None, now, |t, c| async move {
                assert_eq!((t.as_str(), c.as_str()), ("organizations", CID));
                Ok(code())
            })
            .await
            .unwrap();
        assert_eq!(pending.device_code, "secret-device-code");
        assert_eq!(pending.expires_at, now + Duration::from_secs(900));
        assert_eq!(shown.user_code, "ABCD1234");
        // The device code is a credential: it never crosses IPC.
        assert!(!serde_json::to_string(&shown)
            .unwrap()
            .contains("secret-device-code"));

        let bad = start_sign_in_logic("nope".into(), None, now, |_, _| async { Ok(code()) }).await;
        assert!(matches!(bad, Err(CmdError::TeamsInvalidConfig)));
        let bad = start_sign_in_logic(CID.into(), Some("../x".into()), now, |_, _| async {
            Ok(code())
        })
        .await;
        assert!(matches!(bad, Err(CmdError::TeamsInvalidConfig)));
        let rejected = start_sign_in_logic(CID.into(), None, now, |_, _| async {
            Err(TeamsError::Auth)
        })
        .await;
        assert!(matches!(rejected, Err(CmdError::TeamsInvalidConfig)));
    }

    #[test]
    fn poll_steps() {
        let now = Instant::now();
        let p = PendingSignIn {
            client_id: CID.into(),
            tenant: "organizations".into(),
            device_code: "d".into(),
            interval: 5,
            expires_at: now + Duration::from_secs(60),
        };
        assert_eq!(poll_step(&p, now, TokenPoll::Pending), PollStep::Wait(5));
        assert_eq!(poll_step(&p, now, TokenPoll::SlowDown), PollStep::Wait(10));
        assert_eq!(poll_step(&p, now, TokenPoll::Declined), PollStep::Fail);
        assert_eq!(poll_step(&p, now, TokenPoll::Expired), PollStep::Fail);
        assert_eq!(
            poll_step(&p, now, TokenPoll::Granted(tokens(Some("rt")))),
            PollStep::Granted(tokens(Some("rt")))
        );
        let late = now + Duration::from_secs(61);
        assert_eq!(poll_step(&p, late, TokenPoll::Pending), PollStep::Fail);
    }

    #[tokio::test]
    async fn finish_sign_in_switches_account() {
        let (_d, pool) = pool().await;
        tdb::save_identity(&pool, "old", Some("Old")).await.unwrap();
        tdb::replace_catchup(
            &pool,
            &[tdb::ChatInsert {
                id: "old-chat".into(),
                kind: "dm".into(),
                name: None,
                unread_count: 1,
                has_mention: false,
                latest_at: None,
                latest_message_id: None,
                latest_snippet: None,
                web_url: None,
            }],
            &[],
            "t",
        )
        .await
        .unwrap();
        let creds: Arc<dyn TeamsCredentialProvider> = Arc::new(FakeTeamsCreds::default());
        let gen = AtomicU64::new(0);
        let name = finish_sign_in_logic(
            creds.clone(),
            &pool,
            &gen,
            CID,
            "organizations",
            tokens(Some("rt-1")),
            |a| async move {
                assert_eq!(a, "at");
                Ok(me())
            },
        )
        .await
        .unwrap();
        assert_eq!(name, "Ada");
        assert_eq!(gen.load(Ordering::SeqCst), 1);
        assert_eq!(creds.refresh_token().unwrap().as_deref(), Some("rt-1"));
        assert!(tdb::list_conversations(&pool).await.unwrap().is_empty());
        assert_eq!(
            tdb::load_identity(&pool).await.unwrap().unwrap().user_id,
            "me-1"
        );
        assert_eq!(
            tdb::load_config(&pool).await.unwrap(),
            Some(tdb::TeamsConfig {
                client_id: CID.into(),
                tenant: "organizations".into()
            })
        );
    }

    #[tokio::test]
    async fn finish_sign_in_requires_a_refresh_token() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn TeamsCredentialProvider> = Arc::new(FakeTeamsCreds::default());
        let gen = AtomicU64::new(0);
        let r = finish_sign_in_logic(
            creds,
            &pool,
            &gen,
            CID,
            "organizations",
            tokens(None),
            |_| async { Ok(me()) },
        )
        .await;
        assert!(matches!(r, Err(CmdError::TeamsSignInFailed)));
    }

    async fn configured(pool: &SqlitePool) -> Arc<dyn TeamsCredentialProvider> {
        tdb::save_config(pool, CID, "organizations").await.unwrap();
        tdb::save_identity(pool, "me-1", Some("Ada")).await.unwrap();
        Arc::new(FakeTeamsCreds::with("rt-old"))
    }

    #[tokio::test]
    async fn status_is_offline_and_test_rotates_the_refresh_token() {
        let (_d, pool) = pool().await;
        let none: Arc<dyn TeamsCredentialProvider> = Arc::new(FakeTeamsCreds::default());
        assert_eq!(
            get_status_logic(none, &pool).await.unwrap(),
            TeamsStatus::NotConfigured
        );
        let creds = configured(&pool).await;
        assert_eq!(
            get_status_logic(creds.clone(), &pool).await.unwrap(),
            TeamsStatus::Connected {
                user_name: "Ada".into()
            }
        );
        let status = test_connection_logic(
            creds.clone(),
            &pool,
            |cfg, rt| async move {
                assert_eq!((cfg.client_id.as_str(), rt.as_str()), (CID, "rt-old"));
                Ok(tokens(Some("rt-new")))
            },
            |_| async { Ok(me()) },
        )
        .await
        .unwrap();
        assert_eq!(
            status,
            TeamsStatus::Connected {
                user_name: "Ada".into()
            }
        );
        assert_eq!(creds.refresh_token().unwrap().as_deref(), Some("rt-new"));
    }

    #[tokio::test]
    async fn dead_grant_is_a_sanitized_auth_error() {
        let (_d, pool) = pool().await;
        let creds = configured(&pool).await;
        let r = test_connection_logic(
            creds,
            &pool,
            |_, _| async { Err(TeamsError::Auth) },
            |_| async { Ok(me()) },
        )
        .await;
        assert!(matches!(r, Err(CmdError::TeamsAuth)));
        let (_d2, empty) = self::pool().await;
        let none: Arc<dyn TeamsCredentialProvider> = Arc::new(FakeTeamsCreds::default());
        let r = test_connection_logic(
            none,
            &empty,
            |_, _| async { Ok(tokens(None)) },
            |_| async { Ok(me()) },
        )
        .await;
        assert!(matches!(r, Err(CmdError::TeamsNotConfigured)));
    }

    fn chat(id: &str, preview_at: &str, from: &str) -> ParsedChat {
        ParsedChat {
            id: id.into(),
            kind: "dm",
            topic: None,
            last_read: Some("2026-10-01T10:00:00Z".into()),
            members: vec![ParsedMember {
                user_id: Some("u-2".into()),
                display_name: Some("Nick".into()),
            }],
            web_url: Some("https://teams.microsoft.com/l/chat/x/0".into()),
            hidden: false,
            preview: Some(Preview {
                created_at: Some(preview_at.into()),
                from_user_id: Some(from.into()),
            }),
        }
    }

    fn message(id: &str, at: &str, from: &str, text: &str, mention: bool) -> ParsedMessage {
        ParsedMessage {
            id: id.into(),
            created_at: at.into(),
            message_type: "message".into(),
            deleted: false,
            user_id: Some(from.into()),
            user_name: Some("Nick".into()),
            text: text.into(),
            mentioned_user_ids: if mention { vec!["me-1".into()] } else { vec![] },
            broadcast_mention: false,
        }
    }

    #[tokio::test]
    async fn sync_populates_the_board() {
        let (_d, pool) = pool().await;
        let creds = configured(&pool).await;
        let gen = AtomicU64::new(0);
        let fetched = std::sync::Mutex::new(Vec::new());
        let summary = sync_logic(
            creds,
            &pool,
            &gen,
            "now".into(),
            |_, _| async { Ok(tokens(None)) },
            |_| async {
                Ok(vec![
                    chat("c1", "2026-10-01T11:00:00Z", "u-2"),
                    chat("c2", "2026-10-01T09:00:00Z", "u-2"), // already read: not fetched
                ])
            },
            |_, id| {
                fetched.lock().unwrap().push(id.clone());
                async move {
                    Ok(vec![
                        message("3", "2026-10-01T11:00:00Z", "u-2", "re ENG-7 please", true),
                        message("2", "2026-10-01T10:30:00Z", "me-1", "mine", false),
                        message("1", "2026-10-01T09:59:00Z", "u-2", "old", false),
                    ])
                }
            },
        )
        .await
        .unwrap();
        assert_eq!(*fetched.lock().unwrap(), vec!["c1".to_string()]);
        assert_eq!((summary.conversation_count, summary.unread_total), (1, 1));

        let board = get_catchup_logic(&pool, true).await.unwrap();
        assert_eq!(board.conversations.len(), 1);
        let c = &board.conversations[0];
        assert_eq!(
            (c.name.as_deref(), c.unread_count, c.has_mention),
            (Some("Nick"), 1, true)
        );
        assert_eq!(c.latest_ts.as_deref(), Some("3"));
        assert_eq!(board.mentions.len(), 1);
        assert_eq!(
            board.mentions[0].linear_identifier.as_deref(),
            Some("ENG-7")
        );
        assert_eq!(board.last_synced_at.as_deref(), Some("now"));
        assert!(board.threads.is_empty());
    }

    #[tokio::test]
    async fn sync_failure_keeps_the_prior_cache() {
        let (_d, pool) = pool().await;
        let creds = configured(&pool).await;
        let gen = AtomicU64::new(0);
        let ok = |_: String, _: String| async {
            Ok(vec![message(
                "1",
                "2026-10-01T11:00:00Z",
                "u-2",
                "hi",
                false,
            )])
        };
        sync_logic(
            creds.clone(),
            &pool,
            &gen,
            "t1".into(),
            |_, _| async { Ok(tokens(None)) },
            |_| async { Ok(vec![chat("c1", "2026-10-01T11:00:00Z", "u-2")]) },
            ok,
        )
        .await
        .unwrap();
        let r = sync_logic(
            creds,
            &pool,
            &gen,
            "t2".into(),
            |_, _| async { Ok(tokens(None)) },
            |_| async { Ok(vec![chat("c1", "2026-10-01T11:00:00Z", "u-2")]) },
            |_, _| async { Err::<Vec<ParsedMessage>, _>(TeamsError::RateLimited(Some(3))) },
        )
        .await;
        assert!(matches!(r, Err(CmdError::RateLimited)));
        let board = get_catchup_logic(&pool, true).await.unwrap();
        assert_eq!(board.conversations.len(), 1);
        assert_eq!(board.last_synced_at.as_deref(), Some("t1"));
    }

    #[tokio::test]
    async fn one_unreadable_chat_does_not_fail_the_sync() {
        let (_d, pool) = pool().await;
        let creds = configured(&pool).await;
        let gen = AtomicU64::new(0);
        for err in [
            TeamsError::Forbidden,
            TeamsError::Api("404".into()),
            TeamsError::Malformed,
        ] {
            let err = std::sync::Mutex::new(Some(err));
            let summary = sync_logic(
                creds.clone(),
                &pool,
                &gen,
                "now".into(),
                |_, _| async { Ok(tokens(None)) },
                |_| async {
                    Ok(vec![
                        chat("bad", "2026-10-01T11:00:00Z", "u-2"),
                        chat("good", "2026-10-01T11:00:00Z", "u-2"),
                    ])
                },
                |_, id| {
                    let e = (id == "bad").then(|| err.lock().unwrap().take()).flatten();
                    async move {
                        match e {
                            Some(e) => Err(e),
                            None => Ok(vec![message(
                                "1",
                                "2026-10-01T11:00:00Z",
                                "u-2",
                                "hi",
                                false,
                            )]),
                        }
                    }
                },
            )
            .await
            .unwrap();
            assert_eq!(summary.conversation_count, 1);
            let board = get_catchup_logic(&pool, true).await.unwrap();
            assert_eq!(board.conversations[0].id, "good");
        }
    }

    #[test]
    fn forbidden_reads_as_a_permission_problem() {
        assert!(matches!(
            map_teams_err(TeamsError::Forbidden),
            CmdError::TeamsForbidden
        ));
        assert!(matches!(
            map_teams_err(TeamsError::Auth),
            CmdError::TeamsAuth
        ));
    }

    fn pending(code: &str) -> PendingSignIn {
        PendingSignIn {
            client_id: CID.into(),
            tenant: "organizations".into(),
            device_code: code.into(),
            interval: 5,
            expires_at: Instant::now() + Duration::from_secs(60),
        }
    }

    #[test]
    fn a_poll_that_lost_the_race_changes_nothing() {
        // Cancelled while the token request was in flight: the grant is dropped.
        let mut slot: Option<PendingSignIn> = None;
        let r = commit_poll(&mut slot, "old", PollStep::Granted(tokens(Some("rt"))));
        assert!(matches!(r, Err(CmdError::TeamsSignInFailed)));
        assert!(slot.is_none());

        // A newer sign-in started meanwhile: the old poll neither finishes nor clobbers it.
        let mut slot = Some(pending("new"));
        let r = commit_poll(&mut slot, "old", PollStep::Granted(tokens(Some("rt"))));
        assert!(matches!(r, Err(CmdError::TeamsSignInFailed)));
        let r = commit_poll(&mut slot, "old", PollStep::Fail);
        assert!(matches!(r, Err(CmdError::TeamsSignInFailed)));
        assert_eq!(slot.as_ref().unwrap().device_code, "new");
    }

    #[test]
    fn a_current_poll_commits() {
        let mut slot = Some(pending("d"));
        assert_eq!(
            commit_poll(&mut slot, "d", PollStep::Wait(10)).unwrap(),
            Committed::Wait(10)
        );
        assert_eq!(slot.as_ref().unwrap().interval, 10);
        assert_eq!(
            commit_poll(&mut slot, "d", PollStep::Granted(tokens(Some("rt")))).unwrap(),
            Committed::Granted(tokens(Some("rt")))
        );
        assert!(slot.is_none());
        let mut slot = Some(pending("d"));
        assert!(commit_poll(&mut slot, "d", PollStep::Fail).is_err());
        assert!(slot.is_none());
    }

    #[tokio::test]
    async fn sync_aborts_when_the_generation_moves() {
        let (_d, pool) = pool().await;
        let creds = configured(&pool).await;
        let gen = AtomicU64::new(0);
        let r = sync_logic(
            creds,
            &pool,
            &gen,
            "now".into(),
            |_, _| async { Ok(tokens(None)) },
            |_| async { Ok(vec![chat("c1", "2026-10-01T11:00:00Z", "u-2")]) },
            |_, _| {
                gen.fetch_add(1, Ordering::SeqCst);
                async {
                    Ok(vec![message(
                        "1",
                        "2026-10-01T11:00:00Z",
                        "u-2",
                        "hi",
                        false,
                    )])
                }
            },
        )
        .await;
        assert!(matches!(r, Err(CmdError::WorkspaceChanged)));
        assert!(get_catchup_logic(&pool, true)
            .await
            .unwrap()
            .conversations
            .is_empty());
    }

    #[tokio::test]
    async fn clear_wipes_cache_and_grant() {
        let (_d, pool) = pool().await;
        let creds = configured(&pool).await;
        let gen = AtomicU64::new(0);
        clear_account_logic(creds.clone(), &pool, &gen)
            .await
            .unwrap();
        assert_eq!(creds.refresh_token().unwrap(), None);
        assert_eq!(tdb::load_identity(&pool).await.unwrap(), None);
        assert_eq!(gen.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn open_links_stay_on_teams() {
        let chat_id = "19:abc@thread.v2";
        assert_eq!(
            open_link_logic(None, chat_id, Some("1616964509832")),
            "https://teams.microsoft.com/l/message/19:abc@thread.v2/1616964509832?context=%7B%22contextType%22%3A%22chat%22%7D"
        );
        assert_eq!(
            open_link_logic(
                Some("https://teams.microsoft.com/l/chat/19%3Aabc/0?tenantId=t"),
                chat_id,
                None
            ),
            "https://teams.microsoft.com/l/chat/19%3Aabc/0?tenantId=t"
        );
        // A non-Teams stored URL is never opened; fall back to a built link.
        assert_eq!(
            open_link_logic(Some("https://evil.example/"), chat_id, None),
            "https://teams.microsoft.com/l/chat/19:abc@thread.v2/0"
        );
        assert!(open_link_logic(None, "a/b?c", Some("x/y"))
            .starts_with("https://teams.microsoft.com/l/message/a%2Fb%3Fc/x%2Fy?"));
    }
}
