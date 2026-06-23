-- Slack catch-up board (read-only, single workspace). Cache + computed unread state.
CREATE TABLE slack_conversations (
  id              TEXT PRIMARY KEY,   -- Slack conversation id (Cxxxx | Dxxxx | Gxxxx)
  kind            TEXT NOT NULL,      -- channel | dm | group_dm
  name            TEXT,               -- channel name, or resolved DM partner name(s)
  partner_user_id TEXT,              -- for DMs: the other user's id (NULL otherwise)
  unread_count    INTEGER NOT NULL,   -- computed, excludes the viewer's own messages
  has_mention     INTEGER NOT NULL,   -- bool: any unread message here mentions the viewer
  unread_threads  INTEGER NOT NULL,   -- count of this conversation's threads with unread replies
  last_read_ts    TEXT,               -- Slack last_read marker captured at sync
  latest_ts       TEXT,               -- most recent unread message ts
  latest_snippet  TEXT,               -- preview text of the most recent unread message
  synced_at       TEXT NOT NULL
);
CREATE INDEX idx_slack_conv_kind ON slack_conversations(kind);

CREATE TABLE slack_messages (
  conversation_id   TEXT NOT NULL,
  ts                TEXT NOT NULL,      -- message ts, unique within a conversation
  thread_ts         TEXT,              -- parent ts if a threaded reply (NULL for top-level)
  user_id           TEXT,
  user_name         TEXT,
  user_avatar       TEXT,
  text              TEXT,              -- raw Slack mrkdwn (rendered client-side)
  is_mention        INTEGER NOT NULL,   -- bool
  is_unread         INTEGER NOT NULL,   -- bool
  linear_identifier TEXT,              -- uppercase Linear id extracted from text, nullable
  created_at        TEXT NOT NULL,      -- ISO derived from ts
  raw_json          TEXT,
  PRIMARY KEY (conversation_id, ts)
);
CREATE INDEX idx_slack_msg_conv ON slack_messages(conversation_id);
CREATE INDEX idx_slack_msg_thread ON slack_messages(thread_ts);
CREATE INDEX idx_slack_msg_mention ON slack_messages(is_mention);
CREATE INDEX idx_slack_msg_linear ON slack_messages(linear_identifier);

CREATE TABLE slack_users (
  id        TEXT PRIMARY KEY,
  name      TEXT,
  avatar    TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE slack_sync_meta (
  key   TEXT PRIMARY KEY,            -- last_synced_at | conversation_count | unread_total
  value TEXT
);
