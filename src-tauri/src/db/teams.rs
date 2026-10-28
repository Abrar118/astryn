//! Teams catch-up cache. Read queries return the provider-neutral chat-board
//! row shape (the same JSON keys as the Slack rows) so one frontend board
//! renders both providers.

use sqlx::SqlitePool;

pub const TEAMS_USER_ID_KEY: &str = "teams_user_id";
pub const TEAMS_USER_NAME_KEY: &str = "teams_user_name";
pub const TEAMS_SYNCED_AT_KEY: &str = "teams_last_synced_at";
pub const TEAMS_CLIENT_ID_KEY: &str = "teams_client_id";
pub const TEAMS_TENANT_KEY: &str = "teams_tenant";

#[derive(Debug, Clone)]
pub struct ChatInsert {
    pub id: String,
    pub kind: String,
    pub name: Option<String>,
    pub unread_count: i64,
    pub has_mention: bool,
    pub latest_at: Option<String>,
    pub latest_message_id: Option<String>,
    pub latest_snippet: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MessageInsert {
    pub chat_id: String,
    pub id: String,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
    pub text: Option<String>,
    pub is_mention: bool,
    pub linear_identifier: Option<String>,
    pub created_at: String,
}

/// Neutral conversation row (`ChatConversation` in TS). `latest_ts` carries the
/// newest unread message id (the "Open in Teams" target), as Slack's carries
/// its message ts.
#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ChatConversationRow {
    pub id: String,
    pub kind: String,
    pub name: Option<String>,
    pub partner_user_id: Option<String>,
    pub unread_count: i64,
    pub has_mention: bool,
    pub unread_threads: i64,
    pub latest_ts: Option<String>,
    pub latest_snippet: Option<String>,
}

/// Neutral message row (`ChatMessage` in TS). `ts` carries the Graph message id.
#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRow {
    pub conversation_id: String,
    pub ts: String,
    pub thread_ts: Option<String>,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
    pub user_avatar: Option<String>,
    pub text: Option<String>,
    pub is_mention: bool,
    pub linear_identifier: Option<String>,
    pub linear_issue_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, PartialEq)]
pub struct TeamsIdentity {
    pub user_id: String,
    pub user_name: Option<String>,
}

#[derive(Debug, PartialEq)]
pub struct TeamsConfig {
    pub client_id: String,
    pub tenant: String,
}

/// Whole-cache replace in one transaction (all-or-nothing, like Slack).
pub async fn replace_catchup(
    pool: &SqlitePool,
    chats: &[ChatInsert],
    messages: &[MessageInsert],
    synced_at: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM teams_chats")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM teams_messages")
        .execute(&mut *tx)
        .await?;
    for c in chats {
        sqlx::query(
            "INSERT INTO teams_chats
               (id, kind, name, unread_count, has_mention, latest_at, latest_message_id,
                latest_snippet, web_url, synced_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        )
        .bind(&c.id)
        .bind(&c.kind)
        .bind(&c.name)
        .bind(c.unread_count)
        .bind(c.has_mention)
        .bind(&c.latest_at)
        .bind(&c.latest_message_id)
        .bind(&c.latest_snippet)
        .bind(&c.web_url)
        .bind(synced_at)
        .execute(&mut *tx)
        .await?;
    }
    for m in messages {
        sqlx::query(
            "INSERT INTO teams_messages
               (chat_id, id, user_id, user_name, text, is_mention, linear_identifier, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(chat_id, id) DO NOTHING",
        )
        .bind(&m.chat_id)
        .bind(&m.id)
        .bind(&m.user_id)
        .bind(&m.user_name)
        .bind(&m.text)
        .bind(m.is_mention)
        .bind(&m.linear_identifier)
        .bind(&m.created_at)
        .execute(&mut *tx)
        .await?;
    }
    upsert_setting(&mut tx, TEAMS_SYNCED_AT_KEY, synced_at).await?;
    tx.commit().await
}

async fn upsert_setting(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    key: &str,
    value: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Drop the Teams cache, identity, and sync time (an account switch). The app
/// registration config is kept so the user can sign in again.
pub async fn wipe_teams_cache(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for t in ["teams_chats", "teams_messages"] {
        sqlx::query(&format!("DELETE FROM {t}"))
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("DELETE FROM settings WHERE key IN (?1, ?2, ?3)")
        .bind(TEAMS_USER_ID_KEY)
        .bind(TEAMS_USER_NAME_KEY)
        .bind(TEAMS_SYNCED_AT_KEY)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

/// Everything Teams stored, including the app registration config.
pub async fn remove_all_teams_data(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    wipe_teams_cache(pool).await?;
    sqlx::query("DELETE FROM settings WHERE key IN (?1, ?2)")
        .bind(TEAMS_CLIENT_ID_KEY)
        .bind(TEAMS_TENANT_KEY)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn save_identity(
    pool: &SqlitePool,
    user_id: &str,
    user_name: Option<&str>,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    upsert_setting(&mut tx, TEAMS_USER_ID_KEY, user_id).await?;
    match user_name {
        Some(n) => upsert_setting(&mut tx, TEAMS_USER_NAME_KEY, n).await?,
        None => {
            sqlx::query("DELETE FROM settings WHERE key = ?1")
                .bind(TEAMS_USER_NAME_KEY)
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await
}

pub async fn load_identity(pool: &SqlitePool) -> Result<Option<TeamsIdentity>, sqlx::Error> {
    let user_id = crate::db::load_setting(pool, TEAMS_USER_ID_KEY).await?;
    let user_name = crate::db::load_setting(pool, TEAMS_USER_NAME_KEY).await?;
    Ok(user_id.map(|user_id| TeamsIdentity { user_id, user_name }))
}

pub async fn save_config(
    pool: &SqlitePool,
    client_id: &str,
    tenant: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    upsert_setting(&mut tx, TEAMS_CLIENT_ID_KEY, client_id).await?;
    upsert_setting(&mut tx, TEAMS_TENANT_KEY, tenant).await?;
    tx.commit().await
}

pub async fn load_config(pool: &SqlitePool) -> Result<Option<TeamsConfig>, sqlx::Error> {
    let client_id = crate::db::load_setting(pool, TEAMS_CLIENT_ID_KEY).await?;
    let tenant = crate::db::load_setting(pool, TEAMS_TENANT_KEY).await?;
    Ok(match (client_id, tenant) {
        (Some(client_id), Some(tenant)) => Some(TeamsConfig { client_id, tenant }),
        _ => None,
    })
}

pub async fn list_conversations(
    pool: &SqlitePool,
) -> Result<Vec<ChatConversationRow>, sqlx::Error> {
    sqlx::query_as::<_, ChatConversationRow>(
        "SELECT id, kind, name, NULL AS partner_user_id, unread_count, has_mention,
                0 AS unread_threads, latest_message_id AS latest_ts, latest_snippet
         FROM teams_chats
         ORDER BY (latest_at IS NULL), latest_at DESC",
    )
    .fetch_all(pool)
    .await
}

pub async fn chat_web_url(pool: &SqlitePool, chat_id: &str) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT web_url FROM teams_chats WHERE id = ?1")
            .bind(chat_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|r| r.0))
}

pub async fn list_mentions(
    pool: &SqlitePool,
    include_tracker: bool,
) -> Result<Vec<ChatMessageRow>, sqlx::Error> {
    message_rows(
        pool,
        "m.is_mention = 1",
        "m.created_at DESC",
        None,
        include_tracker,
    )
    .await
}

pub async fn list_chat_messages(
    pool: &SqlitePool,
    chat_id: &str,
    include_tracker: bool,
) -> Result<Vec<ChatMessageRow>, sqlx::Error> {
    message_rows(
        pool,
        "m.chat_id = ?1",
        "m.created_at ASC",
        Some(chat_id),
        include_tracker,
    )
    .await
}

async fn message_rows(
    pool: &SqlitePool,
    where_clause: &str,
    order: &str,
    bind: Option<&str>,
    include_tracker: bool,
) -> Result<Vec<ChatMessageRow>, sqlx::Error> {
    let (issue_col, issue_join) = if include_tracker {
        (
            "i.id",
            "LEFT JOIN issues i ON i.identifier = m.linear_identifier",
        )
    } else {
        ("NULL", "")
    };
    let sql = format!(
        "SELECT m.chat_id AS conversation_id, m.id AS ts, NULL AS thread_ts, m.user_id, m.user_name,
                NULL AS user_avatar, m.text, m.is_mention, m.linear_identifier,
                {issue_col} AS linear_issue_id, m.created_at
         FROM teams_messages m
         {issue_join}
         WHERE {where_clause}
         ORDER BY {order}"
    );
    let mut q = sqlx::query_as::<_, ChatMessageRow>(&sql);
    if let Some(b) = bind {
        q = q.bind(b);
    }
    q.fetch_all(pool).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    fn chat(id: &str, latest: &str) -> ChatInsert {
        ChatInsert {
            id: id.into(),
            kind: "dm".into(),
            name: Some("Nick".into()),
            unread_count: 1,
            has_mention: false,
            latest_at: Some(latest.into()),
            latest_message_id: Some(format!("m-{id}")),
            latest_snippet: Some("hi".into()),
            web_url: Some("https://teams.microsoft.com/l/chat/x/0".into()),
        }
    }

    fn msg(chat: &str, id: &str, at: &str, mention: bool, linear: Option<&str>) -> MessageInsert {
        MessageInsert {
            chat_id: chat.into(),
            id: id.into(),
            user_id: Some("u-2".into()),
            user_name: Some("Nick".into()),
            text: Some("body".into()),
            is_mention: mention,
            linear_identifier: linear.map(str::to_string),
            created_at: at.into(),
        }
    }

    #[tokio::test]
    async fn replace_reads_back_in_the_neutral_shape() {
        let (_d, pool) = pool().await;
        replace_catchup(
            &pool,
            &[
                chat("c1", "2026-10-01T00:00:00Z"),
                chat("c2", "2026-10-02T00:00:00Z"),
            ],
            &[
                msg("c1", "2", "2026-10-01T00:00:02Z", true, None),
                msg("c1", "1", "2026-10-01T00:00:01Z", false, None),
            ],
            "now",
        )
        .await
        .unwrap();
        let convs = list_conversations(&pool).await.unwrap();
        assert_eq!(
            convs.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            ["c2", "c1"]
        );
        assert_eq!(convs[0].unread_threads, 0);
        assert_eq!(convs[0].latest_ts.as_deref(), Some("m-c2"));
        let msgs = list_chat_messages(&pool, "c1", true).await.unwrap();
        assert_eq!(
            msgs.iter().map(|m| m.ts.as_str()).collect::<Vec<_>>(),
            ["1", "2"]
        );
        assert_eq!(list_mentions(&pool, true).await.unwrap().len(), 1);
        assert_eq!(
            crate::db::load_setting(&pool, TEAMS_SYNCED_AT_KEY)
                .await
                .unwrap()
                .as_deref(),
            Some("now")
        );
        assert_eq!(
            chat_web_url(&pool, "c1").await.unwrap().as_deref(),
            Some("https://teams.microsoft.com/l/chat/x/0")
        );

        replace_catchup(&pool, &[], &[], "later").await.unwrap();
        assert!(list_conversations(&pool).await.unwrap().is_empty());
        assert!(list_chat_messages(&pool, "c1", true)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn linear_join_follows_the_tracker_flag() {
        let (_d, pool) = pool().await;
        sqlx::query("INSERT INTO issues (id, identifier, title, url, created_at, updated_at, synced_at) VALUES ('iss-1','ENG-1','x','u','t','t','t')")
            .execute(&pool).await.unwrap();
        replace_catchup(
            &pool,
            &[chat("c1", "t")],
            &[msg("c1", "1", "t", true, Some("ENG-1"))],
            "now",
        )
        .await
        .unwrap();
        assert_eq!(
            list_mentions(&pool, true).await.unwrap()[0]
                .linear_issue_id
                .as_deref(),
            Some("iss-1")
        );
        let off = list_mentions(&pool, false).await.unwrap();
        assert_eq!(off[0].linear_issue_id, None);
        assert_eq!(off[0].linear_identifier.as_deref(), Some("ENG-1"));
    }

    #[tokio::test]
    async fn wipe_keeps_config_and_remove_all_drops_it() {
        let (_d, pool) = pool().await;
        save_config(&pool, "cid", "organizations").await.unwrap();
        save_identity(&pool, "me-1", Some("Ada")).await.unwrap();
        replace_catchup(
            &pool,
            &[chat("c1", "t")],
            &[msg("c1", "1", "t", false, None)],
            "now",
        )
        .await
        .unwrap();
        assert_eq!(
            load_identity(&pool).await.unwrap(),
            Some(TeamsIdentity {
                user_id: "me-1".into(),
                user_name: Some("Ada".into())
            })
        );

        wipe_teams_cache(&pool).await.unwrap();
        assert_eq!(load_identity(&pool).await.unwrap(), None);
        assert!(list_conversations(&pool).await.unwrap().is_empty());
        assert_eq!(
            crate::db::load_setting(&pool, TEAMS_SYNCED_AT_KEY)
                .await
                .unwrap(),
            None
        );
        assert!(load_config(&pool).await.unwrap().is_some());

        remove_all_teams_data(&pool).await.unwrap();
        assert_eq!(load_config(&pool).await.unwrap(), None);
    }

    /// The board renders both providers, so Teams rows must serialize with
    /// exactly the Slack rows' keys.
    #[test]
    fn rows_match_the_slack_board_contract() {
        fn keys(v: serde_json::Value) -> Vec<String> {
            let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
            k.sort();
            k
        }
        let teams_conv = ChatConversationRow {
            id: "c".into(),
            kind: "dm".into(),
            name: None,
            partner_user_id: None,
            unread_count: 0,
            has_mention: false,
            unread_threads: 0,
            latest_ts: None,
            latest_snippet: None,
        };
        let slack_conv = crate::db::slack::ConversationRow {
            id: "c".into(),
            kind: "dm".into(),
            name: None,
            partner_user_id: None,
            unread_count: 0,
            has_mention: false,
            unread_threads: 0,
            latest_ts: None,
            latest_snippet: None,
        };
        assert_eq!(
            keys(serde_json::to_value(teams_conv).unwrap()),
            keys(serde_json::to_value(slack_conv).unwrap())
        );

        let teams_msg = ChatMessageRow {
            conversation_id: "c".into(),
            ts: "1".into(),
            thread_ts: None,
            user_id: None,
            user_name: None,
            user_avatar: None,
            text: None,
            is_mention: false,
            linear_identifier: None,
            linear_issue_id: None,
            created_at: "t".into(),
        };
        let slack_msg = crate::db::slack::MessageRow {
            conversation_id: "c".into(),
            ts: "1".into(),
            thread_ts: None,
            user_id: None,
            user_name: None,
            user_avatar: None,
            text: None,
            is_mention: false,
            linear_identifier: None,
            linear_issue_id: None,
            created_at: "t".into(),
        };
        assert_eq!(
            keys(serde_json::to_value(teams_msg).unwrap()),
            keys(serde_json::to_value(slack_msg).unwrap())
        );
    }
}
