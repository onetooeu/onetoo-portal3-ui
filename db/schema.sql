-- ONETOO Portal OMEGA FULL - D1 schema
-- Bind D1 database as "DB" in Cloudflare Pages project settings.
-- Optional R2 bucket for large blobs: bind as "ARTIFACTS".

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ams_envelopes (
  id TEXT PRIMARY KEY,
  ts_created TEXT NOT NULL,
  ts_updated TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  from_id TEXT,
  to_id TEXT,
  thread_id TEXT,
  status TEXT
);

CREATE INDEX IF NOT EXISTS idx_ams_env_updated ON ams_envelopes(ts_updated);
CREATE INDEX IF NOT EXISTS idx_ams_env_to ON ams_envelopes(to_id);
CREATE INDEX IF NOT EXISTS idx_ams_env_thread ON ams_envelopes(thread_id);

CREATE TABLE IF NOT EXISTS artifacts (
  key TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  ts_created TEXT NOT NULL,
  ts_updated TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  content_type TEXT,
  note TEXT,
  stored_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_artifacts_updated ON artifacts(ts_updated);

CREATE TABLE IF NOT EXISTS room_messages (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL,
  ts TEXT NOT NULL,
  from_id TEXT,
  kind TEXT,
  body_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_room_room_ts ON room_messages(room, ts);

CREATE TABLE IF NOT EXISTS notary_records (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  kind TEXT,
  subject TEXT,
  sha256 TEXT,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_notary_ts ON notary_records(ts);

CREATE TABLE IF NOT EXISTS federation_handshakes (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  remote TEXT,
  snapshot_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_fed_ts ON federation_handshakes(ts);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  data_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(ts);
