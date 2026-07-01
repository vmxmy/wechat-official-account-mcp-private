-- Initial D1 schema for the Cloudflare Workers migration.
-- Mirrors the existing SQLite tables created by SqliteStorageManager.

CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY,
  app_id TEXT NOT NULL,
  app_secret TEXT NOT NULL,
  token TEXT,
  encoding_aes_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS access_tokens (
  id INTEGER PRIMARY KEY,
  access_token TEXT NOT NULL,
  expires_in INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  media_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  url TEXT
);

CREATE TABLE IF NOT EXISTS permanent_media (
  media_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  update_time INTEGER,
  url TEXT
);

CREATE TABLE IF NOT EXISTS drafts (
  media_id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  update_time INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS publishes (
  publish_id TEXT PRIMARY KEY,
  msg_data_id TEXT NOT NULL,
  idx INTEGER,
  article_url TEXT,
  content TEXT,
  publish_time INTEGER NOT NULL,
  publish_status INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_tokens_expires_at ON access_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_access_tokens_created_at ON access_tokens(created_at);
CREATE INDEX IF NOT EXISTS idx_media_created_at ON media(created_at);
CREATE INDEX IF NOT EXISTS idx_permanent_media_created_at ON permanent_media(created_at);
CREATE INDEX IF NOT EXISTS idx_drafts_update_time ON drafts(update_time);
CREATE INDEX IF NOT EXISTS idx_publishes_publish_time ON publishes(publish_time);
CREATE INDEX IF NOT EXISTS idx_publishes_status ON publishes(publish_status);
