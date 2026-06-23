use serde_json::Value;

use super::SlackError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConvKind {
    Channel,
    Dm,
    GroupDm,
}

impl ConvKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ConvKind::Channel => "channel",
            ConvKind::Dm => "dm",
            ConvKind::GroupDm => "group_dm",
        }
    }
}

#[derive(Debug, Clone)]
pub struct AuthTest {
    pub user_id: String,
    pub team_id: String,
    pub url: String,
    pub user: String,
}

#[derive(Debug, Clone)]
pub struct ParsedConversation {
    pub id: String,
    pub kind: ConvKind,
    pub name: Option<String>,
    pub is_member: bool,
    pub partner_user_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedInfo {
    pub last_read: Option<String>,
    pub unread_count_display: Option<i64>,
    pub latest_ts: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ParsedMessage {
    pub ts: String,
    pub thread_ts: Option<String>,
    pub user_id: Option<String>,
    pub text: String,
    pub subtype: Option<String>,
    pub reply_count: Option<i64>,
    pub latest_reply: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ParsedUser {
    pub id: String,
    pub name: Option<String>,
    pub avatar: Option<String>,
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(str::to_string)
}

pub fn parse_auth_test(v: &Value) -> Result<AuthTest, SlackError> {
    Ok(AuthTest {
        user_id: str_field(v, "user_id").ok_or(SlackError::Malformed)?,
        team_id: str_field(v, "team_id").ok_or(SlackError::Malformed)?,
        url: str_field(v, "url").unwrap_or_default(),
        user: str_field(v, "user").unwrap_or_default(),
    })
}

/// Returns parsed member conversations plus the (non-empty) pagination cursor.
pub fn parse_conversations(v: &Value) -> Result<(Vec<ParsedConversation>, Option<String>), SlackError> {
    let channels = v.get("channels").and_then(|c| c.as_array()).ok_or(SlackError::Malformed)?;
    let mut rows = Vec::with_capacity(channels.len());
    for c in channels {
        let id = match str_field(c, "id") {
            Some(id) => id,
            None => continue,
        };
        let is_im = c.get("is_im").and_then(|b| b.as_bool()).unwrap_or(false);
        let is_mpim = c.get("is_mpim").and_then(|b| b.as_bool()).unwrap_or(false);
        let kind = if is_im {
            ConvKind::Dm
        } else if is_mpim {
            ConvKind::GroupDm
        } else {
            ConvKind::Channel
        };
        rows.push(ParsedConversation {
            id,
            kind,
            name: str_field(c, "name"),
            is_member: c.get("is_member").and_then(|b| b.as_bool()).unwrap_or(is_im || is_mpim),
            partner_user_id: if is_im { str_field(c, "user") } else { None },
        });
    }
    let cursor = v
        .get("response_metadata")
        .and_then(|m| m.get("next_cursor"))
        .and_then(|c| c.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Ok((rows, cursor))
}

pub fn parse_conversation_info(v: &Value) -> ParsedInfo {
    let ch = v.get("channel").cloned().unwrap_or(Value::Null);
    ParsedInfo {
        last_read: str_field(&ch, "last_read"),
        unread_count_display: ch.get("unread_count_display").and_then(|n| n.as_i64()),
        latest_ts: ch.get("latest").and_then(|l| l.get("ts")).and_then(|t| t.as_str()).map(str::to_string),
    }
}

pub fn parse_messages(v: &Value) -> Vec<ParsedMessage> {
    v.get("messages")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    Some(ParsedMessage {
                        ts: str_field(m, "ts")?,
                        thread_ts: str_field(m, "thread_ts"),
                        user_id: str_field(m, "user"),
                        text: str_field(m, "text").unwrap_or_default(),
                        subtype: str_field(m, "subtype"),
                        reply_count: m.get("reply_count").and_then(|n| n.as_i64()),
                        latest_reply: str_field(m, "latest_reply"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn parse_user(v: &Value) -> Option<ParsedUser> {
    let u = v.get("user")?;
    let id = str_field(u, "id")?;
    let profile = u.get("profile").cloned().unwrap_or(Value::Null);
    let display = str_field(&profile, "display_name").filter(|s| !s.is_empty());
    let name = display.or_else(|| str_field(u, "real_name")).filter(|s| !s.is_empty());
    Some(ParsedUser {
        id,
        name,
        avatar: str_field(&profile, "image_48"),
    })
}

#[cfg(test)]
mod parse_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_auth_test() {
        let v = json!({"ok":true,"user_id":"U1","team_id":"T1","url":"https://w.slack.com/","user":"abrar"});
        let a = parse_auth_test(&v).unwrap();
        assert_eq!((a.user_id.as_str(), a.team_id.as_str(), a.user.as_str()), ("U1", "T1", "abrar"));
    }

    #[test]
    fn parse_auth_test_missing_fields_is_malformed() {
        assert!(matches!(parse_auth_test(&json!({"ok":true})), Err(SlackError::Malformed)));
    }

    #[test]
    fn classifies_conversation_kinds_and_cursor() {
        let v = json!({"ok":true,"channels":[
            {"id":"C1","name":"eng","is_im":false,"is_mpim":false,"is_member":true},
            {"id":"D1","is_im":true,"is_member":true,"user":"U2"},
            {"id":"G1","is_mpim":true,"is_member":true}
        ],"response_metadata":{"next_cursor":"abc"}});
        let (rows, cursor) = parse_conversations(&v).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].kind, ConvKind::Channel);
        assert_eq!(rows[1].kind, ConvKind::Dm);
        assert_eq!(rows[1].partner_user_id.as_deref(), Some("U2"));
        assert_eq!(rows[2].kind, ConvKind::GroupDm);
        assert_eq!(cursor.as_deref(), Some("abc"));
    }

    #[test]
    fn empty_cursor_is_none() {
        let v = json!({"ok":true,"channels":[],"response_metadata":{"next_cursor":""}});
        let (_rows, cursor) = parse_conversations(&v).unwrap();
        assert_eq!(cursor, None);
    }

    #[test]
    fn parses_conversation_info() {
        let v = json!({"ok":true,"channel":{"id":"C1","last_read":"100.000","unread_count_display":3,"latest":{"ts":"105.000"}}});
        let info = parse_conversation_info(&v);
        assert_eq!(info.last_read.as_deref(), Some("100.000"));
        assert_eq!(info.unread_count_display, Some(3));
        assert_eq!(info.latest_ts.as_deref(), Some("105.000"));
    }

    #[test]
    fn parses_messages() {
        let v = json!({"ok":true,"messages":[
            {"ts":"101.0","user":"U2","text":"hi <@U1>","reply_count":2,"latest_reply":"103.0"},
            {"ts":"102.0","user":"U2","text":"joined","subtype":"channel_join"}
        ]});
        let msgs = parse_messages(&v);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].text, "hi <@U1>");
        assert_eq!(msgs[0].reply_count, Some(2));
        assert_eq!(msgs[1].subtype.as_deref(), Some("channel_join"));
    }

    #[test]
    fn parses_user_prefers_display_name() {
        let v = json!({"ok":true,"user":{"id":"U2","real_name":"Real Name","profile":{"display_name":"disp","image_48":"http://a/x.png"}}});
        let u = parse_user(&v).unwrap();
        assert_eq!(u.name.as_deref(), Some("disp"));
        assert_eq!(u.avatar.as_deref(), Some("http://a/x.png"));
    }

    #[test]
    fn parses_user_falls_back_to_real_name() {
        let v = json!({"ok":true,"user":{"id":"U2","real_name":"Real Name","profile":{"display_name":"","image_48":"http://a/x.png"}}});
        let u = parse_user(&v).unwrap();
        assert_eq!(u.name.as_deref(), Some("Real Name"));
    }
}
