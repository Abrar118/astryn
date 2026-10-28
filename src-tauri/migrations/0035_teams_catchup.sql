-- Microsoft Teams catch-up board (read-only chats). Cache of unread state only;
-- identity, sync time and app config live in `settings`; the refresh token
-- lives in the OS keychain.
CREATE TABLE teams_chats (
  id             TEXT PRIMARY KEY,   -- Graph chat id
  kind           TEXT NOT NULL,      -- dm (oneOnOne) | group_dm (group, meeting)
  name           TEXT,               -- chat topic, or the other members' names
  unread_count   INTEGER NOT NULL,   -- excludes the viewer's own and system messages
  has_mention    INTEGER NOT NULL,   -- bool: an unread message @mentions the viewer
  latest_at      TEXT,               -- createdDateTime of the newest unread message
  latest_message_id TEXT,            -- id of that message (Open in Teams target)
  latest_snippet TEXT,
  web_url        TEXT,               -- chat.webUrl, for "Open in Teams"
  synced_at      TEXT NOT NULL
);

-- Unread message bodies (plain text) for the in-app reader and Mentions.
CREATE TABLE teams_messages (
  chat_id           TEXT NOT NULL,
  id                TEXT NOT NULL,   -- Graph message id
  user_id           TEXT,
  user_name         TEXT,
  text              TEXT,
  is_mention        INTEGER NOT NULL,
  linear_identifier TEXT,            -- uppercase issue identifier found in text
  created_at        TEXT NOT NULL,   -- Graph createdDateTime
  PRIMARY KEY (chat_id, id)
);
CREATE INDEX idx_teams_msg_mention ON teams_messages(is_mention);
