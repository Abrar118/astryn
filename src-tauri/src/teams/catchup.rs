//! Pure Microsoft Graph parsing and the Teams read model. No I/O.
//!
//! Shapes follow the v1.0 docs for List chats (`$expand=members,lastMessagePreview`),
//! List messages in a chat, and the chatMessage resource. Live verification
//! against a real tenant is still pending.

use serde_json::Value;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use super::TeamsError;

#[derive(Debug, Clone, PartialEq)]
pub struct Me {
    pub id: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedMember {
    pub user_id: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Preview {
    pub created_at: Option<String>,
    pub from_user_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedChat {
    pub id: String,
    /// Board kind: `dm` for one-on-one, `group_dm` for group and meeting chats.
    pub kind: &'static str,
    pub topic: Option<String>,
    pub last_read: Option<String>,
    pub members: Vec<ParsedMember>,
    pub web_url: Option<String>,
    /// `viewpoint.isHidden`: the viewer hid this chat.
    pub hidden: bool,
    pub preview: Option<Preview>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedMessage {
    pub id: String,
    pub created_at: String,
    pub message_type: String,
    pub deleted: bool,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
    pub text: String,
    pub mentioned_user_ids: Vec<String>,
    /// An @mention of the whole conversation (e.g. @everyone).
    pub broadcast_mention: bool,
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(str::to_string)
}

fn path<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .try_fold(v, |cur, k| cur.get(*k))
        .filter(|x| !x.is_null())
}

pub fn parse_time(s: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(s, &Rfc3339).ok()
}

pub fn parse_me(v: &Value) -> Result<Me, TeamsError> {
    Ok(Me {
        id: str_field(v, "id").ok_or(TeamsError::Malformed)?,
        display_name: str_field(v, "displayName").filter(|s| !s.is_empty()),
    })
}

fn chat_kind(chat_type: Option<&str>) -> &'static str {
    match chat_type {
        Some("oneOnOne") => "dm",
        _ => "group_dm",
    }
}

/// One page of `GET /me/chats` plus its `@odata.nextLink`.
pub fn parse_chats(v: &Value) -> Result<(Vec<ParsedChat>, Option<String>), TeamsError> {
    let items = v
        .get("value")
        .and_then(|x| x.as_array())
        .ok_or(TeamsError::Malformed)?;
    let chats = items
        .iter()
        .filter_map(|c| {
            let members = c
                .get("members")
                .and_then(|m| m.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|m| ParsedMember {
                            user_id: str_field(m, "userId"),
                            display_name: str_field(m, "displayName"),
                        })
                        .collect()
                })
                .unwrap_or_default();
            let preview = path(c, &["lastMessagePreview"]).map(|p| Preview {
                created_at: str_field(p, "createdDateTime"),
                from_user_id: path(p, &["from", "user", "id"])
                    .and_then(|x| x.as_str())
                    .map(str::to_string),
            });
            Some(ParsedChat {
                id: str_field(c, "id")?,
                kind: chat_kind(c.get("chatType").and_then(|t| t.as_str())),
                topic: str_field(c, "topic").filter(|t| !t.trim().is_empty()),
                last_read: path(c, &["viewpoint", "lastMessageReadDateTime"])
                    .and_then(|x| x.as_str())
                    .map(str::to_string),
                members,
                web_url: str_field(c, "webUrl"),
                hidden: path(c, &["viewpoint", "isHidden"]).and_then(|x| x.as_bool()) == Some(true),
                preview,
            })
        })
        .collect();
    Ok((chats, str_field(v, "@odata.nextLink")))
}

/// Messages of one `GET /chats/{id}/messages` page.
pub fn parse_messages(v: &Value) -> Result<Vec<ParsedMessage>, TeamsError> {
    let items = v
        .get("value")
        .and_then(|x| x.as_array())
        .ok_or(TeamsError::Malformed)?;
    Ok(items
        .iter()
        .filter_map(|m| {
            let user = path(m, &["from", "user"]);
            let app = path(m, &["from", "application"]);
            let mentions = m
                .get("mentions")
                .and_then(|x| x.as_array())
                .cloned()
                .unwrap_or_default();
            let content = path(m, &["body", "content"])
                .and_then(|x| x.as_str())
                .unwrap_or("");
            let is_html =
                path(m, &["body", "contentType"]).and_then(|x| x.as_str()) == Some("html");
            Some(ParsedMessage {
                id: str_field(m, "id")?,
                created_at: str_field(m, "createdDateTime")?,
                message_type: str_field(m, "messageType").unwrap_or_default(),
                deleted: path(m, &["deletedDateTime"]).is_some(),
                user_id: user.and_then(|u| str_field(u, "id")),
                user_name: user
                    .and_then(|u| str_field(u, "displayName"))
                    .or_else(|| app.and_then(|a| str_field(a, "displayName"))),
                text: if is_html {
                    html_to_text(content)
                } else {
                    content.trim().to_string()
                },
                mentioned_user_ids: mentions
                    .iter()
                    .filter_map(|x| path(x, &["mentioned", "user", "id"]))
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect(),
                broadcast_mention: mentions
                    .iter()
                    .any(|x| path(x, &["mentioned", "conversation"]).is_some()),
            })
        })
        .collect())
}

/// Reduce a Teams HTML body to readable plain text: block tags become line
/// breaks, other tags are dropped (`<at>` keeps its name text), entities are
/// decoded, and attachments/images get a short placeholder when nothing else
/// remains.
pub fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find('<') {
        out.push_str(&rest[..start]);
        let after = &rest[start..];
        let end = match after.find('>') {
            Some(e) => e,
            None => {
                rest = "";
                break;
            }
        };
        let tag = after[1..end].trim().to_ascii_lowercase();
        let name = tag
            .trim_start_matches('/')
            .split(|c: char| c.is_whitespace() || c == '/')
            .next()
            .unwrap_or("");
        let closing = tag.starts_with('/');
        match name {
            "br" => out.push('\n'),
            "p" | "div" | "li" | "tr" | "blockquote" | "h1" | "h2" | "h3" if closing => {
                out.push('\n')
            }
            _ => {}
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    let text = decode_entities(&out);
    // Collapse runs of blank lines and trim trailing spaces per line.
    let mut lines: Vec<&str> = Vec::new();
    for line in text.lines().map(str::trim_end) {
        if line.trim().is_empty() && lines.last().is_none_or(|l| l.trim().is_empty()) {
            continue;
        }
        lines.push(line);
    }
    let joined = lines.join("\n").trim().to_string();
    if joined.is_empty() {
        let lower = html.to_ascii_lowercase();
        if lower.contains("<attachment") {
            return "[Attachment]".into();
        }
        if lower.contains("<img") {
            return "[Image]".into();
        }
    }
    joined
}

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let after = &rest[i..];
        let decoded = after.find(';').filter(|&e| e <= 10).and_then(|e| {
            let ent = &after[1..e];
            let ch = match ent {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                _ => ent
                    .strip_prefix("#x")
                    .or_else(|| ent.strip_prefix("#X"))
                    .and_then(|h| u32::from_str_radix(h, 16).ok())
                    .or_else(|| ent.strip_prefix('#').and_then(|d| d.parse().ok()))
                    .and_then(char::from_u32),
            };
            ch.map(|c| (c, e))
        });
        match decoded {
            Some((c, e)) => {
                out.push(c);
                rest = &after[e + 1..];
            }
            None => {
                out.push('&');
                rest = &after[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn after_marker(created: &str, last_read: Option<&str>) -> bool {
    let created = match parse_time(created) {
        Some(t) => t,
        None => return false,
    };
    match last_read.and_then(parse_time) {
        Some(read) => created > read,
        // No (or the 0001-01-01 sentinel / unparsable) marker: never read.
        None => true,
    }
}

/// Worth fetching messages for: not hidden by the viewer, and the newest
/// message is after the viewer's read marker and was not sent by the viewer
/// (sending marks a chat read).
pub fn chat_has_unread(chat: &ParsedChat, viewer_id: &str) -> bool {
    if chat.hidden {
        return false;
    }
    match &chat.preview {
        Some(Preview {
            created_at: Some(created),
            from_user_id,
        }) => {
            from_user_id.as_deref() != Some(viewer_id)
                && after_marker(created, chat.last_read.as_deref())
        }
        _ => false,
    }
}

/// User messages after the read marker that the viewer did not write.
pub fn unread_messages<'a>(
    messages: &'a [ParsedMessage],
    last_read: Option<&str>,
    viewer_id: &str,
) -> Vec<&'a ParsedMessage> {
    messages
        .iter()
        .filter(|m| m.message_type == "message" && !m.deleted)
        .filter(|m| m.user_id.as_deref() != Some(viewer_id))
        .filter(|m| after_marker(&m.created_at, last_read))
        .collect()
}

pub fn is_mention(m: &ParsedMessage, viewer_id: &str) -> bool {
    m.broadcast_mention || m.mentioned_user_ids.iter().any(|id| id == viewer_id)
}

/// Topic, else the other members' names ("Ada, Bob, Cy +2").
pub fn chat_name(chat: &ParsedChat, viewer_id: &str) -> Option<String> {
    if let Some(t) = &chat.topic {
        return Some(t.clone());
    }
    let others: Vec<&str> = chat
        .members
        .iter()
        .filter(|m| m.user_id.as_deref() != Some(viewer_id))
        .filter_map(|m| m.display_name.as_deref())
        .filter(|n| !n.is_empty())
        .collect();
    match others.len() {
        0 => None,
        1..=3 => Some(others.join(", ")),
        n => Some(format!("{} +{}", others[..3].join(", "), n - 3)),
    }
}

pub fn snippet(text: &str) -> String {
    let one_line = text.replace('\n', " ");
    if one_line.chars().count() > 140 {
        one_line.chars().take(140).collect::<String>() + "…"
    } else {
        one_line
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VIEWER: &str = "me-1";

    /// Shape from the "List chats" docs (`$expand=members,lastMessagePreview`).
    fn chats_fixture() -> Value {
        serde_json::json!({
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/chats?$skiptoken=abc",
            "value": [
                {
                    "id": "19:a_b@unq.gbl.spaces",
                    "topic": null,
                    "chatType": "oneOnOne",
                    "webUrl": "https://teams.microsoft.com/l/chat/19%3Aa_b%40unq.gbl.spaces/0?tenantId=t",
                    "viewpoint": { "isHidden": false, "lastMessageReadDateTime": "2021-06-05T00:31:30.047Z" },
                    "members": [
                        { "userId": VIEWER, "displayName": "Me" },
                        { "userId": "u-2", "displayName": "Nick Fury" }
                    ],
                    "lastMessagePreview": {
                        "id": "1622853091207",
                        "createdDateTime": "2021-06-05T00:31:31.207Z",
                        "isDeleted": false,
                        "messageType": "message",
                        "body": { "contentType": "text", "content": "Testing unread read status" },
                        "from": { "application": null, "device": null,
                                  "user": { "id": "u-2", "displayName": "Nick Fury", "userIdentityType": "aadUser" } }
                    }
                },
                {
                    "id": "19:group@thread.v2",
                    "topic": "Group chat",
                    "chatType": "group",
                    "viewpoint": { "isHidden": false, "lastMessageReadDateTime": "2021-06-04T05:34:23.712Z" },
                    "lastMessagePreview": {
                        "id": "1622784857324",
                        "createdDateTime": "2021-06-04T05:34:17.324Z",
                        "messageType": "systemEventMessage",
                        "from": null,
                        "body": { "contentType": "html", "content": "<systemEventMessage/>" }
                    }
                },
                {
                    "id": "19:meeting_x@thread.v2",
                    "topic": "Standup",
                    "chatType": "meeting",
                    "viewpoint": { "isHidden": false, "lastMessageReadDateTime": "0001-01-01T00:00:00Z" },
                    "lastMessagePreview": null
                }
            ]
        })
    }

    #[test]
    fn parses_chats_page() {
        let (chats, next) = parse_chats(&chats_fixture()).unwrap();
        assert_eq!(chats.len(), 3);
        assert_eq!(
            next.as_deref(),
            Some("https://graph.microsoft.com/v1.0/me/chats?$skiptoken=abc")
        );
        let dm = &chats[0];
        assert_eq!(dm.kind, "dm");
        assert_eq!(dm.topic, None);
        assert_eq!(
            dm.preview.as_ref().unwrap().from_user_id.as_deref(),
            Some("u-2")
        );
        assert_eq!(chats[1].kind, "group_dm");
        assert_eq!(chats[1].preview.as_ref().unwrap().from_user_id, None);
        assert_eq!(chats[2].kind, "group_dm");
        assert_eq!(chats[2].preview, None);
        assert!(matches!(
            parse_chats(&serde_json::json!({})),
            Err(TeamsError::Malformed)
        ));
    }

    #[test]
    fn unread_candidates_follow_the_read_marker() {
        let (chats, _) = parse_chats(&chats_fixture()).unwrap();
        assert!(chat_has_unread(&chats[0], VIEWER)); // preview after lastMessageReadDateTime
        assert!(!chat_has_unread(&chats[1], VIEWER)); // preview before the marker
        assert!(!chat_has_unread(&chats[2], VIEWER)); // no messages at all
        let mut mine = chats[0].clone();
        mine.preview.as_mut().unwrap().from_user_id = Some(VIEWER.into());
        assert!(!chat_has_unread(&mine, VIEWER)); // sending marks the chat read
        let mut never = chats[0].clone();
        never.last_read = Some("0001-01-01T00:00:00Z".into());
        assert!(chat_has_unread(&never, VIEWER));
    }

    #[test]
    fn hidden_chats_are_skipped() {
        let mut page = chats_fixture();
        page["value"][0]["viewpoint"]["isHidden"] = serde_json::json!(true);
        let (chats, _) = parse_chats(&page).unwrap();
        assert!(chats[0].hidden);
        assert!(!chats[1].hidden);
        // Unread by the read marker, but the viewer hid it.
        assert!(!chat_has_unread(&chats[0], VIEWER));
    }

    #[test]
    fn names_chats_from_topic_or_other_members() {
        let (chats, _) = parse_chats(&chats_fixture()).unwrap();
        assert_eq!(chat_name(&chats[0], VIEWER).as_deref(), Some("Nick Fury"));
        assert_eq!(chat_name(&chats[1], VIEWER).as_deref(), Some("Group chat"));
        let mut big = chats[0].clone();
        big.members = ["A", "B", "C", "D", "E"]
            .iter()
            .map(|n| ParsedMember {
                user_id: Some(n.to_lowercase()),
                display_name: Some(n.to_string()),
            })
            .collect();
        assert_eq!(chat_name(&big, VIEWER).as_deref(), Some("A, B, C +2"));
        big.members.clear();
        assert_eq!(chat_name(&big, VIEWER), None);
    }

    /// Shape from the "List messages in a chat" docs and chatMessage mentions.
    fn messages_fixture() -> Value {
        serde_json::json!({
            "value": [
                {
                    "id": "1616964509832", "messageType": "message",
                    "createdDateTime": "2021-03-28T20:48:29.832Z", "deletedDateTime": null,
                    "from": { "application": null, "device": null,
                              "user": { "id": "u-2", "displayName": "Robin Kline", "userIdentityType": "aadUser" } },
                    "body": { "contentType": "html", "content": "<div><div><at id=\"0\">Me</at>&nbsp;can you check ENG-42?</div></div>" },
                    "mentions": [ { "id": 0, "mentionText": "Me",
                                    "mentioned": { "application": null, "device": null, "conversation": null,
                                                   "user": { "id": VIEWER, "displayName": "Me", "userIdentityType": "aadUser" } } } ]
                },
                {
                    "id": "1616964500000", "messageType": "message",
                    "createdDateTime": "2021-03-28T20:40:00.000Z", "deletedDateTime": null,
                    "from": { "user": { "id": VIEWER, "displayName": "Me" } },
                    "body": { "contentType": "text", "content": "my own" },
                    "mentions": []
                },
                {
                    "id": "1616964400000", "messageType": "message",
                    "createdDateTime": "2021-03-28T20:30:00.000Z", "deletedDateTime": "2021-03-28T20:31:00.000Z",
                    "from": { "user": { "id": "u-2", "displayName": "Robin Kline" } },
                    "body": { "contentType": "text", "content": "" },
                    "mentions": []
                },
                {
                    "id": "1616964300000", "messageType": "systemEventMessage",
                    "createdDateTime": "2021-03-28T20:20:00.000Z",
                    "from": null,
                    "body": { "contentType": "html", "content": "<systemEventMessage/>" },
                    "mentions": []
                },
                {
                    "id": "1616964200000", "messageType": "message",
                    "createdDateTime": "2021-03-28T20:10:00.000Z",
                    "from": { "user": null, "application": { "id": "app", "displayName": "Build Bot" } },
                    "body": { "contentType": "html", "content": "<p>Build &amp; deploy done</p><attachment id=\"x\"></attachment>" },
                    "mentions": [ { "id": 0, "mentionText": "Everyone",
                                    "mentioned": { "user": null, "conversation": { "id": "19:g@thread.v2", "conversationIdentityType": "chat" } } } ]
                },
                {
                    "id": "1616964100000", "messageType": "message",
                    "createdDateTime": "2021-03-28T19:00:00.000Z",
                    "from": { "user": { "id": "u-3", "displayName": "Old" } },
                    "body": { "contentType": "text", "content": "already read" },
                    "mentions": []
                }
            ]
        })
    }

    #[test]
    fn parses_messages_and_applies_the_read_model() {
        let msgs = parse_messages(&messages_fixture()).unwrap();
        assert_eq!(msgs.len(), 6);
        assert_eq!(msgs[0].text, "Me can you check ENG-42?");
        assert_eq!(msgs[0].user_name.as_deref(), Some("Robin Kline"));
        assert!(msgs[2].deleted);
        assert_eq!(msgs[4].user_name.as_deref(), Some("Build Bot"));
        assert_eq!(msgs[4].user_id, None);
        assert_eq!(msgs[4].text, "Build & deploy done");

        let unread = unread_messages(&msgs, Some("2021-03-28T19:30:00Z"), VIEWER);
        let ids: Vec<&str> = unread.iter().map(|m| m.id.as_str()).collect();
        // Own, deleted, system, and pre-marker messages are excluded.
        assert_eq!(ids, vec!["1616964509832", "1616964200000"]);

        assert!(is_mention(&msgs[0], VIEWER));
        assert!(is_mention(&msgs[4], VIEWER)); // @everyone-style conversation mention
        assert!(!is_mention(&msgs[5], VIEWER));
        assert!(!is_mention(&msgs[0], "someone-else"));
    }

    #[test]
    fn unparsable_times_are_not_unread() {
        let mut msgs = parse_messages(&messages_fixture()).unwrap();
        msgs[0].created_at = "2021-03-1706:47:05.123Z".into(); // typo from the docs sample
        let unread = unread_messages(&msgs[..1], None, VIEWER);
        assert!(unread.is_empty());
    }

    #[test]
    fn html_to_text_cases() {
        assert_eq!(html_to_text("<p>one</p><p>two</p>"), "one\ntwo");
        assert_eq!(html_to_text("a<br>b<br/>c"), "a\nb\nc");
        assert_eq!(
            html_to_text("&lt;tag&gt; &quot;q&quot; &#39;s&#39; &#x41;"),
            "<tag> \"q\" 's' A"
        );
        assert_eq!(html_to_text("AT&T rocks"), "AT&T rocks");
        assert_eq!(
            html_to_text("<attachment id=\"1\"></attachment>"),
            "[Attachment]"
        );
        assert_eq!(html_to_text("<div><img src=\"x\"></div>"), "[Image]");
        assert_eq!(html_to_text("<div>\n\n\n<p>x</p>\n\n\n</div>"), "x");
        assert_eq!(html_to_text("unclosed <b"), "unclosed");
    }

    #[test]
    fn parses_me() {
        let me =
            parse_me(&serde_json::json!({ "id": "me-1", "displayName": "Ada Lovelace" })).unwrap();
        assert_eq!(
            me,
            Me {
                id: "me-1".into(),
                display_name: Some("Ada Lovelace".into())
            }
        );
        assert!(parse_me(&serde_json::json!({})).is_err());
    }
}
