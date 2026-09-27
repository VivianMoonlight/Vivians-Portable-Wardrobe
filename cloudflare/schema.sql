CREATE TABLE IF NOT EXISTS wardrobes (
  account_hash TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  index_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  created_ip_hash TEXT NOT NULL,
  created_day INTEGER NOT NULL,
  write_day INTEGER NOT NULL,
  writes_today INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS wardrobes_creation_limit ON wardrobes (created_ip_hash, created_day);
