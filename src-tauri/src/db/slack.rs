use sqlx::SqlitePool;

pub const SLACK_USER_ID_KEY: &str = "slack_user_id";
pub const SLACK_TEAM_ID_KEY: &str = "slack_team_id";
pub const SLACK_URL_KEY: &str = "slack_workspace_url";
pub const SLACK_WORKSPACE_NAME_KEY: &str = "slack_workspace_name";
pub const SLACK_SYNCED_AT_KEY: &str = "last_synced_at";

#[derive(Debug, Clone)]
pub struct ConversationInsert {
    pub id: String,
    pub kind: String,
    pub name: Option<String>,
    pub partner_user_id: Option<String>,
    pub unread_count: i64,
    pub has_mention: bool,
    pub unread_threads: i64,
    pub last_read_ts: Option<String>,
    pub latest_ts: Option<String>,
    pub latest_snippet: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MessageInsert {
    pub conversation_id: String,
    pub ts: String,
    pub thread_ts: Option<String>,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
    pub user_avatar: Option<String>,
    pub text: Option<String>,
    pub is_mention: bool,
    pub is_unread: bool,
    pub linear_identifier: Option<String>,
    pub created_at: String,
    pub raw_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UserInsert {
    pub id: String,
    pub name: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRow {
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

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MessageRow {
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

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRow {
    pub conversation_id: String,
    pub conversation_name: Option<String>,
    pub thread_ts: String,
    pub unread_replies: i64,
    pub has_mention: bool,
    pub latest_ts: String,
}

#[derive(Debug, PartialEq)]
pub struct SlackIdentity {
    pub user_id: String,
    pub team_id: String,
    pub url: String,
    pub workspace_name: Option<String>,
}

/// Whole-cache replace: a single transaction clears the prior conversations,
/// messages, and users, then inserts the new dataset + sync timestamp. The
/// dataset is small (one workspace), so all-or-nothing keeps the cache from
/// ever being left half-written.
pub async fn replace_catchup(
    pool: &SqlitePool,
    conversations: &[ConversationInsert],
    messages: &[MessageInsert],
    users: &[UserInsert],
    synced_at: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM slack_conversations").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM slack_messages").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM slack_users").execute(&mut *tx).await?;
    for c in conversations {
        sqlx::query(
            "INSERT INTO slack_conversations
               (id, kind, name, partner_user_id, unread_count, has_mention, unread_threads,
                last_read_ts, latest_ts, latest_snippet, synced_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        )
        .bind(&c.id).bind(&c.kind).bind(&c.name).bind(&c.partner_user_id)
        .bind(c.unread_count).bind(c.has_mention).bind(c.unread_threads)
        .bind(&c.last_read_ts).bind(&c.latest_ts).bind(&c.latest_snippet).bind(synced_at)
        .execute(&mut *tx).await?;
    }
    for m in messages {
        sqlx::query(
            "INSERT INTO slack_messages
               (conversation_id, ts, thread_ts, user_id, user_name, user_avatar, text,
                is_mention, is_unread, linear_identifier, created_at, raw_json)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
             ON CONFLICT(conversation_id, ts) DO NOTHING",
        )
        .bind(&m.conversation_id).bind(&m.ts).bind(&m.thread_ts).bind(&m.user_id)
        .bind(&m.user_name).bind(&m.user_avatar).bind(&m.text).bind(m.is_mention)
        .bind(m.is_unread).bind(&m.linear_identifier).bind(&m.created_at).bind(&m.raw_json)
        .execute(&mut *tx).await?;
    }
    for u in users {
        sqlx::query(
            "INSERT INTO slack_users (id, name, avatar, synced_at) VALUES (?1,?2,?3,?4)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, synced_at = excluded.synced_at",
        )
        .bind(&u.id).bind(&u.name).bind(&u.avatar).bind(synced_at)
        .execute(&mut *tx).await?;
    }
    sqlx::query(
        "INSERT INTO slack_sync_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(SLACK_SYNCED_AT_KEY).bind(synced_at)
    .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

/// Drop all Slack cache + identity. Leaves Linear and GitHub untouched.
pub async fn wipe_slack_cache(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for t in ["slack_conversations", "slack_messages", "slack_users", "slack_sync_meta"] {
        sqlx::query(&format!("DELETE FROM {t}")).execute(&mut *tx).await?;
    }
    sqlx::query("DELETE FROM settings WHERE key IN (?1, ?2, ?3, ?4)")
        .bind(SLACK_USER_ID_KEY).bind(SLACK_TEAM_ID_KEY).bind(SLACK_URL_KEY).bind(SLACK_WORKSPACE_NAME_KEY)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn save_slack_identity(
    pool: &SqlitePool,
    user_id: &str,
    team_id: &str,
    url: &str,
    workspace_name: Option<&str>,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let mut pairs = vec![
        (SLACK_USER_ID_KEY, user_id.to_string()),
        (SLACK_TEAM_ID_KEY, team_id.to_string()),
        (SLACK_URL_KEY, url.to_string()),
    ];
    if let Some(name) = workspace_name {
        pairs.push((SLACK_WORKSPACE_NAME_KEY, name.to_string()));
    }
    for (k, v) in pairs {
        sqlx::query("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .bind(k).bind(v).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn load_slack_identity(pool: &SqlitePool) -> Result<Option<SlackIdentity>, sqlx::Error> {
    let user_id = crate::db::load_setting(pool, SLACK_USER_ID_KEY).await?;
    let team_id = crate::db::load_setting(pool, SLACK_TEAM_ID_KEY).await?;
    let url = crate::db::load_setting(pool, SLACK_URL_KEY).await?;
    let workspace_name = crate::db::load_setting(pool, SLACK_WORKSPACE_NAME_KEY).await?;
    Ok(match (user_id, team_id, url) {
        (Some(user_id), Some(team_id), Some(url)) => Some(SlackIdentity { user_id, team_id, url, workspace_name }),
        _ => None,
    })
}

pub async fn list_conversations(pool: &SqlitePool) -> Result<Vec<ConversationRow>, sqlx::Error> {
    sqlx::query_as::<_, ConversationRow>(
        "SELECT id, kind, name, partner_user_id, unread_count, has_mention, unread_threads, latest_ts, latest_snippet
         FROM slack_conversations
         ORDER BY (latest_ts IS NULL), latest_ts DESC",
    )
    .fetch_all(pool)
    .await
}

pub async fn list_mentions(pool: &SqlitePool) -> Result<Vec<MessageRow>, sqlx::Error> {
    message_rows(pool, "m.is_mention = 1 AND m.is_unread = 1", "m.ts DESC", None).await
}

pub async fn list_conversation_messages(
    pool: &SqlitePool,
    conversation_id: &str,
) -> Result<Vec<MessageRow>, sqlx::Error> {
    message_rows(pool, "m.conversation_id = ?1 AND m.is_unread = 1", "m.ts ASC", Some(conversation_id)).await
}

async fn message_rows(
    pool: &SqlitePool,
    where_clause: &str,
    order: &str,
    bind: Option<&str>,
) -> Result<Vec<MessageRow>, sqlx::Error> {
    let sql = format!(
        "SELECT m.conversation_id, m.ts, m.thread_ts, m.user_id, m.user_name, m.user_avatar, m.text,
                m.is_mention, m.linear_identifier, i.id AS linear_issue_id, m.created_at
         FROM slack_messages m
         LEFT JOIN issues i ON i.identifier = m.linear_identifier
         WHERE {where_clause}
         ORDER BY {order}"
    );
    let mut q = sqlx::query_as::<_, MessageRow>(&sql);
    if let Some(b) = bind {
        q = q.bind(b);
    }
    q.fetch_all(pool).await
}

pub async fn list_threads(pool: &SqlitePool) -> Result<Vec<ThreadRow>, sqlx::Error> {
    sqlx::query_as::<_, ThreadRow>(
        "SELECT m.conversation_id, c.name AS conversation_name, m.thread_ts,
                COUNT(*) AS unread_replies, MAX(m.is_mention) AS has_mention, MAX(m.ts) AS latest_ts
         FROM slack_messages m
         JOIN slack_conversations c ON c.id = m.conversation_id
         WHERE m.thread_ts IS NOT NULL AND m.is_unread = 1
         GROUP BY m.conversation_id, m.thread_ts
         ORDER BY latest_ts DESC",
    )
    .fetch_all(pool)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db")).await.unwrap();
        (dir, pool)
    }

    fn conv(id: &str, kind: &str, unread: i64) -> ConversationInsert {
        ConversationInsert {
            id: id.into(),
            kind: kind.into(),
            name: Some("eng".into()),
            partner_user_id: None,
            unread_count: unread,
            has_mention: false,
            unread_threads: 0,
            last_read_ts: Some("1.0".into()),
            latest_ts: Some("2.0".into()),
            latest_snippet: Some("hi".into()),
        }
    }

    fn msg(conv: &str, ts: &str, mention: bool, thread: Option<&str>, linear: Option<&str>) -> MessageInsert {
        MessageInsert {
            conversation_id: conv.into(),
            ts: ts.into(),
            thread_ts: thread.map(str::to_string),
            user_id: Some("U2".into()),
            user_name: Some("Bob".into()),
            user_avatar: None,
            text: Some("body".into()),
            is_mention: mention,
            is_unread: true,
            linear_identifier: linear.map(str::to_string),
            created_at: "2026-06-23T00:00:00Z".into(),
            raw_json: None,
        }
    }

    #[tokio::test]
    async fn replace_catchup_inserts_and_replaces() {
        let (_d, pool) = pool().await;
        replace_catchup(
            &pool,
            &[conv("C1", "channel", 2)],
            &[msg("C1", "10.0", true, None, Some("ENG-1")), msg("C1", "11.0", false, Some("9.0"), None)],
            &[UserInsert { id: "U2".into(), name: Some("Bob".into()), avatar: None }],
            "now",
        )
        .await
        .unwrap();
        assert_eq!(list_conversations(&pool).await.unwrap().len(), 1);
        assert_eq!(list_conversation_messages(&pool, "C1").await.unwrap().len(), 2);

        // A second replace wipes the prior dataset (whole-cache replace).
        replace_catchup(&pool, &[conv("C2", "dm", 1)], &[], &[], "now2").await.unwrap();
        let convs = list_conversations(&pool).await.unwrap();
        assert_eq!(convs.len(), 1);
        assert_eq!(convs[0].id, "C2");
        assert!(list_conversation_messages(&pool, "C1").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn mentions_and_threads_are_derived() {
        let (_d, pool) = pool().await;
        replace_catchup(
            &pool,
            &[conv("C1", "channel", 3)],
            &[
                msg("C1", "10.0", true, None, None),       // mention, top-level
                msg("C1", "11.0", false, Some("9.0"), None), // thread reply
                msg("C1", "12.0", true, Some("9.0"), None),  // thread reply + mention
            ],
            &[],
            "now",
        )
        .await
        .unwrap();
        assert_eq!(list_mentions(&pool).await.unwrap().len(), 2);
        let threads = list_threads(&pool).await.unwrap();
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].thread_ts, "9.0");
        assert_eq!(threads[0].unread_replies, 2);
        assert_eq!(threads[0].has_mention, true);
    }

    #[tokio::test]
    async fn messages_join_linear_issue_id() {
        let (_d, pool) = pool().await;
        sqlx::query("INSERT INTO issues (id, identifier, title, url, created_at, updated_at, synced_at) VALUES ('iss-1','ENG-1','x','u','t','t','t')")
            .execute(&pool).await.unwrap();
        replace_catchup(&pool, &[conv("C1", "channel", 1)], &[msg("C1", "10.0", false, None, Some("ENG-1"))], &[], "now").await.unwrap();
        let rows = list_conversation_messages(&pool, "C1").await.unwrap();
        assert_eq!(rows[0].linear_issue_id.as_deref(), Some("iss-1"));
    }

    #[tokio::test]
    async fn identity_roundtrips_and_wipe_clears_everything() {
        let (_d, pool) = pool().await;
        save_slack_identity(&pool, "U1", "T1", "https://w.slack.com/", Some("Acme")).await.unwrap();
        replace_catchup(&pool, &[conv("C1", "channel", 1)], &[msg("C1", "10.0", false, None, None)], &[UserInsert { id: "U2".into(), name: None, avatar: None }], "now").await.unwrap();
        let id = load_slack_identity(&pool).await.unwrap().unwrap();
        assert_eq!((id.user_id.as_str(), id.team_id.as_str()), ("U1", "T1"));

        wipe_slack_cache(&pool).await.unwrap();
        assert!(list_conversations(&pool).await.unwrap().is_empty());
        assert!(list_conversation_messages(&pool, "C1").await.unwrap().is_empty());
        assert_eq!(load_slack_identity(&pool).await.unwrap(), None);
    }
}
