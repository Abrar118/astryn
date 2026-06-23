use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;

use super::{AppState, CmdError};
use crate::db::slack as sdb;
use crate::secrets::SecretStore;
use crate::slack::catchup::{self, AuthTest};
use crate::slack::{SlackCredentialProvider, SlackError};

use super::super::SLACK_COOKIE_ACCOUNT;
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

pub async fn set_slack_credentials_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    token: String,
    cookie: Option<String>,
) -> Result<(), CmdError> {
    // Wipe + bump BEFORE the keyring writes (fail-safe ordering).
    sdb::wipe_slack_cache(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || {
        s.set(SLACK_TOKEN_ACCOUNT, &token)?;
        match cookie {
            Some(c) => s.set(SLACK_COOKIE_ACCOUNT, &c)?,
            None => s.delete(SLACK_COOKIE_ACCOUNT)?,
        }
        Ok::<(), crate::secrets::SecretError>(())
    })
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
    sdb::wipe_slack_cache(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || {
        s.delete(SLACK_TOKEN_ACCOUNT)?;
        s.delete(SLACK_COOKIE_ACCOUNT)?;
        Ok::<(), crate::secrets::SecretError>(())
    })
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
    let identity = sdb::load_slack_identity(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(compute_slack_status(has_token, identity))
}

async fn authorize(
    credentials: &Arc<dyn SlackCredentialProvider>,
) -> Result<crate::slack::SlackAuth, CmdError> {
    let c = credentials.clone();
    tokio::task::spawn_blocking(move || c.auth())
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
    F: FnOnce(crate::slack::SlackAuth) -> Fut,
    Fut: std::future::Future<Output = Result<AuthTest, SlackError>>,
{
    let auth = authorize(&credentials).await?;
    let a = fetch_auth(auth).await.map_err(map_slack_err)?;
    let workspace_name = workspace_name_from_url(&a.url);
    sdb::save_slack_identity(
        pool,
        &a.user_id,
        &a.team_id,
        &a.url,
        workspace_name.as_deref(),
    )
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
async fn fetch_auth_test(
    client: &crate::slack::SlackClient,
    auth: crate::slack::SlackAuth,
) -> Result<AuthTest, SlackError> {
    let body = client.call(&auth, "auth.test", &[]).await?;
    catchup::parse_auth_test(&body)
}

#[tauri::command]
pub async fn set_slack_credentials(
    state: State<'_, AppState>,
    token: String,
    cookie: Option<String>,
) -> Result<(), CmdError> {
    let _g = state.slack_lock.lock().await;
    set_slack_credentials_logic(
        state.secret_store.clone(),
        &state.pool,
        &state.slack_generation,
        token,
        cookie,
    )
    .await
}

#[tauri::command]
pub async fn clear_slack_token(state: State<'_, AppState>) -> Result<(), CmdError> {
    let _g = state.slack_lock.lock().await;
    clear_slack_token_logic(
        state.secret_store.clone(),
        &state.pool,
        &state.slack_generation,
    )
    .await
}

#[tauri::command]
pub async fn get_slack_status(state: State<'_, AppState>) -> Result<SlackStatus, CmdError> {
    get_slack_status_logic(state.secret_store.clone(), &state.pool).await
}

fn map_extract_err(_e: crate::slack::extract::ExtractError) -> CmdError {
    // Sanitized: any extraction failure reads as "not configured / reconnect".
    CmdError::SlackNotConfigured
}

pub async fn detect_slack_credentials_logic<E, EFut, F, FFut>(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    extract: E,
    fetch_auth: F,
) -> Result<SlackStatus, CmdError>
where
    E: FnOnce() -> EFut,
    EFut: std::future::Future<
        Output = Result<crate::slack::extract::ExtractedCreds, crate::slack::extract::ExtractError>,
    >,
    F: FnOnce(crate::slack::SlackAuth) -> FFut,
    FFut: std::future::Future<Output = Result<AuthTest, SlackError>>,
{
    let creds = extract().await.map_err(map_extract_err)?;
    set_slack_credentials_logic(
        store,
        pool,
        generation,
        creds.xoxc.clone(),
        Some(creds.xoxd.clone()),
    )
    .await?;
    let auth = crate::slack::SlackAuth {
        authorization: format!("Bearer {}", creds.xoxc),
        cookie: Some(creds.xoxd),
    };
    let a = fetch_auth(auth).await.map_err(map_slack_err)?;
    let workspace_name = workspace_name_from_url(&a.url);
    sdb::save_slack_identity(
        pool,
        &a.user_id,
        &a.team_id,
        &a.url,
        workspace_name.as_deref(),
    )
    .await
    .map_err(|_| CmdError::Internal)?;
    Ok(SlackStatus::Connected {
        workspace_name,
        user_name: a.user_id,
    })
}

/// Update the two Slack secrets in place — used by self-healing rotation. The
/// account is unchanged (same user, refreshed session), so this does NOT wipe
/// the cache or bump the generation.
pub async fn store_slack_secrets_logic(
    store: Arc<dyn SecretStore>,
    token: String,
    cookie: Option<String>,
) -> Result<(), CmdError> {
    tokio::task::spawn_blocking(move || {
        store.set(SLACK_TOKEN_ACCOUNT, &token)?;
        if let Some(c) = cookie {
            store.set(SLACK_COOKIE_ACCOUNT, &c)?;
        }
        Ok::<(), crate::secrets::SecretError>(())
    })
    .await
    .map_err(|_| CmdError::Internal)?
    .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

#[tauri::command]
pub async fn detect_slack_credentials(state: State<'_, AppState>) -> Result<SlackStatus, CmdError> {
    let _g = state.slack_lock.lock().await;
    let client = state.slack.clone();
    detect_slack_credentials_logic(
        state.secret_store.clone(),
        &state.pool,
        &state.slack_generation,
        || async { crate::slack::extract::extract_credentials().await },
        move |auth| async move { fetch_auth_test(&client, auth).await },
    )
    .await
}

async fn redetect_secrets(state: &AppState) -> Result<(), CmdError> {
    let extracted = crate::slack::extract::extract_credentials()
        .await
        .map_err(map_extract_err)?;
    store_slack_secrets_logic(
        state.secret_store.clone(),
        extracted.xoxc,
        Some(extracted.xoxd),
    )
    .await
}

/// users.info for one user id → resolved name/avatar.
async fn fetch_user(
    client: &crate::slack::SlackClient,
    auth: crate::slack::SlackAuth,
    user_id: String,
) -> Result<catchup::ParsedUser, SlackError> {
    let body = client
        .call(&auth, "users.info", &[("user", &user_id)])
        .await?;
    catchup::parse_user(&body).ok_or(SlackError::Malformed)
}

async fn run_sync(state: &AppState) -> Result<SlackSyncSummary, CmdError> {
    let identity = sdb::load_slack_identity(&state.pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    let viewer_id = identity
        .map(|i| i.user_id)
        .ok_or(CmdError::SlackNotConfigured)?;
    let client_l = state.slack.clone();
    let client_c = state.slack.clone();
    let client_u = state.slack.clone();
    sync_slack_catchup_logic(
        state.slack_credentials.clone(),
        &state.pool,
        &state.slack_generation,
        viewer_id,
        now_iso_slack(),
        move |auth| {
            let c = client_l.clone();
            async move { list_member_conversations(&c, auth).await }
        },
        move |auth, conv_id, _lr| {
            let c = client_c.clone();
            async move { fetch_conversation_data(&c, auth, conv_id).await }
        },
        move |auth, uid| {
            let c = client_u.clone();
            async move { fetch_user(&c, auth, uid).await }
        },
    )
    .await
}

async fn run_test(state: &AppState) -> Result<SlackStatus, CmdError> {
    let client = state.slack.clone();
    test_slack_connection_logic(
        state.slack_credentials.clone(),
        &state.pool,
        move |auth| async move { fetch_auth_test(&client, auth).await },
    )
    .await
}

#[tauri::command]
pub async fn sync_slack_catchup(state: State<'_, AppState>) -> Result<SlackSyncSummary, CmdError> {
    let _g = state.slack_lock.lock().await;
    match run_sync(&state).await {
        // map_slack_err maps SlackError::Auth -> SlackNotConfigured, so this is the rotation signal.
        Err(CmdError::SlackNotConfigured) => {
            redetect_secrets(&state).await?;
            run_sync(&state).await
        }
        other => other,
    }
}

#[tauri::command]
pub async fn test_slack_connection(state: State<'_, AppState>) -> Result<SlackStatus, CmdError> {
    let _g = state.slack_lock.lock().await;
    match run_test(&state).await {
        Err(CmdError::SlackNotConfigured) => {
            redetect_secrets(&state).await?;
            run_test(&state).await
        }
        other => other,
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SlackCatchup {
    pub conversations: Vec<sdb::ConversationRow>,
    pub mentions: Vec<sdb::MessageRow>,
    pub threads: Vec<sdb::ThreadRow>,
    pub last_synced_at: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SlackSyncSummary {
    pub synced: bool,
    pub conversation_count: i64,
    pub unread_total: i64,
}

/// Per-conversation fetch result the orchestrator turns into cache rows.
/// `replies`: (thread_ts, replies-after-last_read) for each candidate thread.
pub struct ConversationData {
    pub info: catchup::ParsedInfo,
    pub messages: Vec<catchup::ParsedMessage>,
    pub replies: Vec<(String, Vec<catchup::ParsedMessage>)>,
}

fn ts_to_iso(ts: &str) -> String {
    let secs = ts
        .split('.')
        .next()
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    time::OffsetDateTime::from_unix_timestamp(secs)
        .ok()
        .and_then(|t| {
            t.format(&time::format_description::well_known::Rfc3339)
                .ok()
        })
        .unwrap_or_default()
}

fn snippet(text: &str) -> String {
    let one_line = text.replace('\n', " ");
    if one_line.chars().count() > 140 {
        one_line.chars().take(140).collect::<String>() + "…"
    } else {
        one_line
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn sync_slack_catchup_logic<L, LF, C, CF, U, UF>(
    credentials: Arc<dyn SlackCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    viewer_id: String,
    now: String,
    list_convs: L,
    fetch_conv: C,
    fetch_user: U,
) -> Result<SlackSyncSummary, CmdError>
where
    L: FnOnce(crate::slack::SlackAuth) -> LF,
    LF: std::future::Future<Output = Result<Vec<catchup::ParsedConversation>, SlackError>>,
    C: Fn(crate::slack::SlackAuth, String, Option<String>) -> CF,
    CF: std::future::Future<Output = Result<ConversationData, SlackError>>,
    U: Fn(crate::slack::SlackAuth, String) -> UF,
    UF: std::future::Future<Output = Result<catchup::ParsedUser, SlackError>>,
{
    let auth = authorize(&credentials).await?;
    let gen0 = generation.load(Ordering::SeqCst);

    let conversations = list_convs(auth.clone()).await.map_err(map_slack_err)?;

    let mut conv_inserts: Vec<sdb::ConversationInsert> = Vec::new();
    let mut msg_inserts: Vec<sdb::MessageInsert> = Vec::new();
    let mut user_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut unread_total = 0i64;

    for conv in &conversations {
        let data = fetch_conv(auth.clone(), conv.id.clone(), None)
            .await
            .map_err(map_slack_err)?;
        let last_read = data.info.last_read.clone();

        // Top-level unread (channels compute from history; DMs trust the display count).
        let unread: Vec<&catchup::ParsedMessage> =
            catchup::unread_messages(&data.messages, &viewer_id);
        let mut has_mention = false;
        let mut latest_ts: Option<String> = None;
        let mut latest_snippet: Option<String> = None;

        for m in &unread {
            let is_mention = catchup::detect_mention(&m.text, &viewer_id);
            has_mention |= is_mention;
            if latest_ts
                .as_deref()
                .map(|cur| catchup::ts_gt(&m.ts, cur))
                .unwrap_or(true)
            {
                latest_ts = Some(m.ts.clone());
                latest_snippet = Some(snippet(&m.text));
            }
            if let Some(u) = &m.user_id {
                user_ids.insert(u.clone());
            }
            msg_inserts.push(sdb::MessageInsert {
                conversation_id: conv.id.clone(),
                ts: m.ts.clone(),
                thread_ts: m.thread_ts.clone(),
                user_id: m.user_id.clone(),
                user_name: None,
                user_avatar: None,
                text: Some(m.text.clone()),
                is_mention,
                is_unread: true,
                linear_identifier: catchup::linear_id(&m.text),
                created_at: ts_to_iso(&m.ts),
                raw_json: None,
            });
        }

        // Thread replies (already fetched after last_read by the caller).
        let mut unread_threads = 0i64;
        for (thread_ts, replies) in &data.replies {
            let reply_unread = catchup::unread_messages(replies, &viewer_id);
            let reply_unread: Vec<&catchup::ParsedMessage> = reply_unread
                .into_iter()
                .filter(|m| &m.ts != thread_ts)
                .collect();
            if reply_unread.is_empty() {
                continue;
            }
            unread_threads += 1;
            for m in reply_unread {
                let is_mention = catchup::detect_mention(&m.text, &viewer_id);
                has_mention |= is_mention;
                if let Some(u) = &m.user_id {
                    user_ids.insert(u.clone());
                }
                msg_inserts.push(sdb::MessageInsert {
                    conversation_id: conv.id.clone(),
                    ts: m.ts.clone(),
                    thread_ts: Some(thread_ts.clone()),
                    user_id: m.user_id.clone(),
                    user_name: None,
                    user_avatar: None,
                    text: Some(m.text.clone()),
                    is_mention,
                    is_unread: true,
                    linear_identifier: catchup::linear_id(&m.text),
                    created_at: ts_to_iso(&m.ts),
                    raw_json: None,
                });
            }
        }

        let unread_count = match (&conv.kind, data.info.unread_count_display) {
            (catchup::ConvKind::Dm, Some(n)) | (catchup::ConvKind::GroupDm, Some(n)) => n,
            _ => unread.len() as i64,
        };
        unread_total += unread_count;

        // Skip conversations with nothing to show.
        if unread_count == 0 && unread_threads == 0 {
            continue;
        }

        conv_inserts.push(sdb::ConversationInsert {
            id: conv.id.clone(),
            kind: conv.kind.as_str().to_string(),
            name: conv.name.clone(),
            partner_user_id: conv.partner_user_id.clone(),
            unread_count,
            has_mention,
            unread_threads,
            last_read_ts: last_read,
            latest_ts,
            latest_snippet,
        });
    }

    // Resolve message authors' names/avatars via users.info (best-effort: a
    // per-user failure leaves that author unresolved, it never fails the sync).
    let mut user_map: std::collections::HashMap<String, catchup::ParsedUser> =
        std::collections::HashMap::new();
    for uid in &user_ids {
        if let Ok(u) = fetch_user(auth.clone(), uid.clone()).await {
            user_map.insert(uid.clone(), u);
        }
    }
    // Fill the resolved names onto the cached messages (read query reads these).
    for m in &mut msg_inserts {
        if let Some(u) = m.user_id.as_ref().and_then(|id| user_map.get(id)) {
            m.user_name = u.name.clone();
            m.user_avatar = u.avatar.clone();
        }
    }
    let users: Vec<sdb::UserInsert> = user_ids
        .iter()
        .map(|uid| {
            let u = user_map.get(uid);
            sdb::UserInsert {
                id: uid.clone(),
                name: u.and_then(|x| x.name.clone()),
                avatar: u.and_then(|x| x.avatar.clone()),
            }
        })
        .collect();

    // Abort if the token changed mid-flight: a partial write would be ambiguous.
    if generation.load(Ordering::SeqCst) != gen0 {
        return Err(CmdError::WorkspaceChanged);
    }

    sdb::replace_catchup(pool, &conv_inserts, &msg_inserts, &users, &now)
        .await
        .map_err(|_| CmdError::Internal)?;

    Ok(SlackSyncSummary {
        synced: true,
        conversation_count: conv_inserts.len() as i64,
        unread_total,
    })
}

pub async fn get_slack_catchup_logic(pool: &SqlitePool) -> Result<SlackCatchup, CmdError> {
    let conversations = sdb::list_conversations(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    let mentions = sdb::list_mentions(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    let threads = sdb::list_threads(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    let last_synced_at = crate::db::load_setting(pool, sdb::SLACK_SYNCED_AT_KEY)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(SlackCatchup {
        conversations,
        mentions,
        threads,
        last_synced_at,
    })
}

pub async fn get_slack_conversation_messages_logic(
    pool: &SqlitePool,
    conversation_id: &str,
) -> Result<Vec<sdb::MessageRow>, CmdError> {
    sdb::list_conversation_messages(pool, conversation_id)
        .await
        .map_err(|_| CmdError::Internal)
}

/// Build the native deep link (and a web fallback) into a Slack conversation/message.
pub fn slack_deep_link_logic(
    identity: &sdb::SlackIdentity,
    conversation_id: &str,
    ts: Option<&str>,
) -> (String, String) {
    let app = match ts {
        Some(ts) => format!(
            "slack://channel?team={}&id={}&message={}",
            identity.team_id, conversation_id, ts
        ),
        None => format!(
            "slack://channel?team={}&id={}",
            identity.team_id, conversation_id
        ),
    };
    let base = identity.url.trim_end_matches('/');
    let web = match ts {
        Some(ts) => format!(
            "{}/archives/{}/p{}",
            base,
            conversation_id,
            ts.replace('.', "")
        ),
        None => format!("{}/archives/{}", base, conversation_id),
    };
    (app, web)
}

/// users.conversations (member channels + DMs + group DMs), paged to completion.
async fn list_member_conversations(
    client: &crate::slack::SlackClient,
    auth: crate::slack::SlackAuth,
) -> Result<Vec<catchup::ParsedConversation>, SlackError> {
    let mut out = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut params: Vec<(&str, &str)> = vec![
            ("types", "public_channel,private_channel,im,mpim"),
            ("exclude_archived", "true"),
            ("limit", "200"),
        ];
        if let Some(c) = &cursor {
            params.push(("cursor", c));
        }
        let body = client.call(&auth, "users.conversations", &params).await?;
        let (mut rows, next) = catchup::parse_conversations(&body)?;
        out.append(&mut rows);
        match next {
            Some(c) if Some(&c) != cursor.as_ref() => cursor = Some(c),
            _ => break,
        }
    }
    Ok(out.into_iter().filter(|c| c.is_member).collect())
}

/// conversations.info + history (+ thread replies) for one conversation.
async fn fetch_conversation_data(
    client: &crate::slack::SlackClient,
    auth: crate::slack::SlackAuth,
    conversation_id: String,
) -> Result<ConversationData, SlackError> {
    let info_body = client
        .call(
            &auth,
            "conversations.info",
            &[("channel", &conversation_id)],
        )
        .await?;
    let info = catchup::parse_conversation_info(&info_body);

    // Only a real ts is a valid `oldest` bound. A never-read DM's last_read is the
    // sentinel 0000000000.000000, which Slack rejects with `invalid_ts_oldest` —
    // and that one error would otherwise abort the entire sync.
    let oldest = info
        .last_read
        .as_deref()
        .filter(|lr| catchup::is_real_ts(lr));

    let mut hist_params: Vec<(&str, &str)> = vec![
        ("channel", &conversation_id),
        ("limit", "100"),
        ("inclusive", "false"),
    ];
    if let Some(lr) = oldest {
        hist_params.push(("oldest", lr));
    }
    let hist_body = client
        .call(&auth, "conversations.history", &hist_params)
        .await?;
    let messages = catchup::parse_messages(&hist_body);

    let mut replies = Vec::new();
    for parent in catchup::thread_parents(&messages, info.last_read.as_deref()) {
        let mut rparams: Vec<(&str, &str)> = vec![
            ("channel", &conversation_id),
            ("ts", &parent.ts),
            ("limit", "100"),
        ];
        if let Some(lr) = oldest {
            rparams.push(("oldest", lr));
        }
        let rbody = client
            .call(&auth, "conversations.replies", &rparams)
            .await?;
        replies.push((parent.ts.clone(), catchup::parse_messages(&rbody)));
    }
    Ok(ConversationData {
        info,
        messages,
        replies,
    })
}

#[tauri::command]
pub async fn get_slack_catchup(state: State<'_, AppState>) -> Result<SlackCatchup, CmdError> {
    get_slack_catchup_logic(&state.pool).await
}

// Tauri maps the JS camelCase arg `conversationId` to the Rust snake_case
// parameter `conversation_id` automatically (matches the existing commands).
#[tauri::command]
pub async fn get_slack_conversation_messages(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<sdb::MessageRow>, CmdError> {
    get_slack_conversation_messages_logic(&state.pool, &conversation_id).await
}

#[tauri::command]
pub async fn slack_deep_link(
    state: State<'_, AppState>,
    conversation_id: String,
    ts: Option<String>,
) -> Result<SlackDeepLink, CmdError> {
    let identity = sdb::load_slack_identity(&state.pool)
        .await
        .map_err(|_| CmdError::Internal)?
        .ok_or(CmdError::SlackNotConfigured)?;
    let (app, web) = slack_deep_link_logic(&identity, &conversation_id, ts.as_deref());
    Ok(SlackDeepLink { app, web })
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SlackDeepLink {
    pub app: String,
    pub web: String,
}

fn now_iso_slack() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::fake::FakeSecretStore;
    use crate::slack::catchup::AuthTest;
    use crate::slack::catchup::{ConvKind, ParsedConversation, ParsedInfo, ParsedMessage};
    use crate::slack::fake::FakeSlackCreds;
    use crate::slack::SlackCredentialProvider;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    #[test]
    fn status_computation() {
        assert!(matches!(
            compute_slack_status(false, None),
            SlackStatus::NotConfigured
        ));
        assert!(matches!(
            compute_slack_status(true, None),
            SlackStatus::Unverified
        ));
        let id = crate::db::slack::SlackIdentity {
            user_id: "U1".into(),
            team_id: "T1".into(),
            url: "u".into(),
            workspace_name: Some("Acme".into()),
        };
        match compute_slack_status(true, Some(id)) {
            SlackStatus::Connected {
                user_name,
                workspace_name,
            } => {
                assert_eq!(user_name, "U1");
                assert_eq!(workspace_name.as_deref(), Some("Acme"));
            }
            _ => panic!("expected Connected"),
        }
    }

    #[tokio::test]
    async fn set_token_wipes_prior_slack_state() {
        let (_d, pool) = pool().await;
        crate::db::slack::save_slack_identity(&pool, "old", "T", "u", None)
            .await
            .unwrap();
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let gen = AtomicU64::new(0);
        set_slack_credentials_logic(store.clone(), &pool, &gen, "xoxp-new".into(), None)
            .await
            .unwrap();
        assert_eq!(
            crate::db::slack::load_slack_identity(&pool).await.unwrap(),
            None
        );
        assert_eq!(gen.load(Ordering::SeqCst), 1);
        assert_eq!(
            store.get(SLACK_TOKEN_ACCOUNT).unwrap(),
            Some("xoxp-new".into())
        );
    }

    #[tokio::test]
    async fn get_status_is_offline() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        assert!(matches!(
            get_slack_status_logic(store.clone(), &pool).await.unwrap(),
            SlackStatus::NotConfigured
        ));
        store.set(SLACK_TOKEN_ACCOUNT, "xoxp-x").unwrap();
        assert!(matches!(
            get_slack_status_logic(store.clone(), &pool).await.unwrap(),
            SlackStatus::Unverified
        ));
        crate::db::slack::save_slack_identity(&pool, "U1", "T1", "u", Some("Acme"))
            .await
            .unwrap();
        match get_slack_status_logic(store, &pool).await.unwrap() {
            SlackStatus::Connected { user_name, .. } => assert_eq!(user_name, "U1"),
            _ => panic!("expected Connected"),
        }
    }

    #[tokio::test]
    async fn test_connection_caches_identity() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn SlackCredentialProvider> =
            Arc::new(FakeSlackCreds(Some(crate::slack::SlackAuth {
                authorization: "Bearer x".into(),
                cookie: None,
            })));
        let status = test_slack_connection_logic(creds, &pool, |_auth| async {
            Ok(AuthTest {
                user_id: "U1".into(),
                team_id: "T1".into(),
                url: "https://acme.slack.com/".into(),
                user: "abrar".into(),
            })
        })
        .await
        .unwrap();
        assert!(matches!(status, SlackStatus::Connected { .. }));
        let id = crate::db::slack::load_slack_identity(&pool)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(id.team_id, "T1");
    }

    #[tokio::test]
    async fn test_connection_without_token_is_not_configured_error() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn SlackCredentialProvider> = Arc::new(FakeSlackCreds(None));
        let r = test_slack_connection_logic(creds, &pool, |_a| async {
            Ok(AuthTest {
                user_id: "U1".into(),
                team_id: "T1".into(),
                url: "u".into(),
                user: "x".into(),
            })
        })
        .await;
        assert!(matches!(r, Err(CmdError::SlackNotConfigured)));
    }

    fn pmsg(ts: &str, user: &str, text: &str) -> ParsedMessage {
        ParsedMessage {
            ts: ts.into(),
            thread_ts: None,
            user_id: Some(user.into()),
            text: text.into(),
            subtype: None,
            reply_count: None,
            latest_reply: None,
        }
    }

    #[tokio::test]
    async fn sync_populates_cache_and_derives_views() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn SlackCredentialProvider> =
            Arc::new(FakeSlackCreds(Some(crate::slack::SlackAuth {
                authorization: "Bearer x".into(),
                cookie: None,
            })));
        let gen = AtomicU64::new(0);
        let convs = vec![ParsedConversation {
            id: "C1".into(),
            kind: ConvKind::Channel,
            name: Some("eng".into()),
            is_member: true,
            partner_user_id: None,
        }];
        let summary = sync_slack_catchup_logic(
            creds,
            &pool,
            &gen,
            "U1".into(),
            "now".into(),
            move |_auth| {
                let convs = convs.clone();
                async move { Ok(convs) }
            },
            move |_auth, _conv_id, _last_read| async move {
                Ok(ConversationData {
                    info: ParsedInfo {
                        last_read: Some("5.0".into()),
                        unread_count_display: None,
                        latest_ts: Some("7.0".into()),
                    },
                    messages: vec![pmsg("6.0", "U2", "hi <@U1>"), pmsg("7.0", "U1", "my own")],
                    replies: vec![],
                })
            },
            // users.info resolves U2 -> Bob; the stored message must carry the name.
            move |_auth, _uid| async {
                Ok(crate::slack::catchup::ParsedUser {
                    id: "U2".into(),
                    name: Some("Bob".into()),
                    avatar: Some("a.png".into()),
                })
            },
        )
        .await
        .unwrap();
        assert!(summary.synced);
        assert_eq!(summary.conversation_count, 1);

        let dash = get_slack_catchup_logic(&pool).await.unwrap();
        assert_eq!(dash.conversations.len(), 1);
        assert_eq!(dash.conversations[0].unread_count, 1); // U1's own message excluded
        assert_eq!(dash.conversations[0].has_mention, true);
        assert_eq!(dash.mentions.len(), 1);
        assert_eq!(dash.mentions[0].user_name.as_deref(), Some("Bob")); // name resolved via users.info
        assert_eq!(dash.mentions[0].user_avatar.as_deref(), Some("a.png"));
    }

    #[tokio::test]
    async fn sync_failure_leaves_prior_cache() {
        let (_d, pool) = pool().await;
        // Seed a prior cache.
        crate::db::slack::replace_catchup(
            &pool,
            &[crate::db::slack::ConversationInsert {
                id: "OLD".into(),
                kind: "channel".into(),
                name: Some("old".into()),
                partner_user_id: None,
                unread_count: 1,
                has_mention: false,
                unread_threads: 0,
                last_read_ts: None,
                latest_ts: Some("1.0".into()),
                latest_snippet: None,
            }],
            &[],
            &[],
            "old",
        )
        .await
        .unwrap();
        let creds: Arc<dyn SlackCredentialProvider> =
            Arc::new(FakeSlackCreds(Some(crate::slack::SlackAuth {
                authorization: "Bearer x".into(),
                cookie: None,
            })));
        let gen = AtomicU64::new(0);
        let r = sync_slack_catchup_logic(
            creds,
            &pool,
            &gen,
            "U1".into(),
            "now".into(),
            |_auth| async { Err::<Vec<ParsedConversation>, _>(SlackError::Network) },
            |_a, _c, _l| async { unreachable!() },
            |_a, _u| async { unreachable!() },
        )
        .await;
        assert!(r.is_err());
        // Prior cache preserved (all-or-nothing).
        assert_eq!(
            get_slack_catchup_logic(&pool)
                .await
                .unwrap()
                .conversations
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn sync_aborts_on_generation_change() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn SlackCredentialProvider> =
            Arc::new(FakeSlackCreds(Some(crate::slack::SlackAuth {
                authorization: "Bearer x".into(),
                cookie: None,
            })));
        let gen = AtomicU64::new(0);
        let convs = vec![ParsedConversation {
            id: "C1".into(),
            kind: ConvKind::Channel,
            name: None,
            is_member: true,
            partner_user_id: None,
        }];
        // Bump the generation on the first per-conversation fetch (simulating a
        // token swap mid-flight) so the guard trips before the cache write.
        let bumped = std::sync::atomic::AtomicBool::new(false);
        let r = sync_slack_catchup_logic(
            creds,
            &pool,
            &gen,
            "U1".into(),
            "now".into(),
            move |_auth| {
                let convs = convs.clone();
                async move { Ok(convs) }
            },
            |_a, _c, _l| {
                if !bumped.swap(true, Ordering::SeqCst) {
                    gen.fetch_add(1, Ordering::SeqCst);
                }
                async move {
                    Ok(ConversationData {
                        info: ParsedInfo::default(),
                        messages: vec![],
                        replies: vec![],
                    })
                }
            },
            |_a, _u| async {
                Ok(crate::slack::catchup::ParsedUser {
                    id: "x".into(),
                    name: None,
                    avatar: None,
                })
            },
        )
        .await;
        assert!(matches!(r, Err(CmdError::WorkspaceChanged)));
        assert!(get_slack_catchup_logic(&pool)
            .await
            .unwrap()
            .conversations
            .is_empty());
    }

    #[test]
    fn deep_link_builds_app_and_web_urls() {
        let id = crate::db::slack::SlackIdentity {
            user_id: "U1".into(),
            team_id: "T1".into(),
            url: "https://acme.slack.com/".into(),
            workspace_name: Some("acme".into()),
        };
        let (app, web) = slack_deep_link_logic(&id, "C1", Some("123.456"));
        assert_eq!(app, "slack://channel?team=T1&id=C1&message=123.456");
        assert_eq!(web, "https://acme.slack.com/archives/C1/p123456");
    }

    #[tokio::test]
    async fn set_credentials_stores_token_and_cookie() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let gen = AtomicU64::new(0);
        set_slack_credentials_logic(
            store.clone(),
            &pool,
            &gen,
            "xoxc-1".into(),
            Some("xoxd-9".into()),
        )
        .await
        .unwrap();
        assert_eq!(
            store.get(SLACK_TOKEN_ACCOUNT).unwrap(),
            Some("xoxc-1".into())
        );
        assert_eq!(
            store.get(SLACK_COOKIE_ACCOUNT).unwrap(),
            Some("xoxd-9".into())
        );
    }

    #[tokio::test]
    async fn set_credentials_without_cookie_clears_stale_cookie() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(SLACK_COOKIE_ACCOUNT, "xoxd-old").unwrap();
        let gen = AtomicU64::new(0);
        set_slack_credentials_logic(store.clone(), &pool, &gen, "xoxp-1".into(), None)
            .await
            .unwrap();
        assert_eq!(store.get(SLACK_COOKIE_ACCOUNT).unwrap(), None);
    }

    #[tokio::test]
    async fn clear_deletes_both_secrets() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(SLACK_TOKEN_ACCOUNT, "xoxc-1").unwrap();
        store.set(SLACK_COOKIE_ACCOUNT, "xoxd-9").unwrap();
        let gen = AtomicU64::new(0);
        clear_slack_token_logic(store.clone(), &pool, &gen)
            .await
            .unwrap();
        assert_eq!(store.get(SLACK_TOKEN_ACCOUNT).unwrap(), None);
        assert_eq!(store.get(SLACK_COOKIE_ACCOUNT).unwrap(), None);
    }

    use crate::slack::extract::{ExtractError, ExtractedCreds};

    #[tokio::test]
    async fn detect_stores_creds_and_verifies_identity() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let gen = AtomicU64::new(0);
        let status = detect_slack_credentials_logic(
            store.clone(),
            &pool,
            &gen,
            || async {
                Ok(ExtractedCreds {
                    xoxc: "xoxc-1".into(),
                    xoxd: "xoxd-9".into(),
                    workspace_hint: None,
                })
            },
            |_auth| async {
                Ok(AuthTest {
                    user_id: "U1".into(),
                    team_id: "T1".into(),
                    url: "https://acme.slack.com/".into(),
                    user: "x".into(),
                })
            },
        )
        .await
        .unwrap();
        assert!(matches!(status, SlackStatus::Connected { .. }));
        assert_eq!(
            store.get(SLACK_TOKEN_ACCOUNT).unwrap(),
            Some("xoxc-1".into())
        );
        assert_eq!(
            store.get(SLACK_COOKIE_ACCOUNT).unwrap(),
            Some("xoxd-9".into())
        );
    }

    #[tokio::test]
    async fn detect_surfaces_extract_failure() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let gen = AtomicU64::new(0);
        let r = detect_slack_credentials_logic(
            store,
            &pool,
            &gen,
            || async { Err(ExtractError::NotInstalled) },
            |_auth| async {
                Ok(AuthTest {
                    user_id: "U1".into(),
                    team_id: "T1".into(),
                    url: "u".into(),
                    user: "x".into(),
                })
            },
        )
        .await;
        assert!(matches!(r, Err(CmdError::SlackNotConfigured)));
    }

    #[tokio::test]
    async fn store_secrets_updates_both_without_wiping_cache() {
        let (_d, pool) = pool().await;
        // Seed a cached conversation; rotation must NOT clear it.
        crate::db::slack::replace_catchup(
            &pool,
            &[crate::db::slack::ConversationInsert {
                id: "C1".into(),
                kind: "channel".into(),
                name: Some("eng".into()),
                partner_user_id: None,
                unread_count: 1,
                has_mention: false,
                unread_threads: 0,
                last_read_ts: None,
                latest_ts: Some("2.0".into()),
                latest_snippet: None,
            }],
            &[],
            &[],
            "now",
        )
        .await
        .unwrap();
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store_slack_secrets_logic(store.clone(), "xoxc-2".into(), Some("xoxd-2".into()))
            .await
            .unwrap();
        assert_eq!(
            store.get(SLACK_TOKEN_ACCOUNT).unwrap(),
            Some("xoxc-2".into())
        );
        assert_eq!(
            store.get(SLACK_COOKIE_ACCOUNT).unwrap(),
            Some("xoxd-2".into())
        );
        // Cache survived (rotation is not an account switch).
        assert_eq!(
            get_slack_catchup_logic(&pool)
                .await
                .unwrap()
                .conversations
                .len(),
            1
        );
    }
}
