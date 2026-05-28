-- Naming audit results: items flagged by the admin-triggered naming audit job

CREATE TABLE naming_audit_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_run_id  UUID NOT NULL,
  media_type    TEXT NOT NULL,
  imdb_id       TEXT,
  current_path  TEXT NOT NULL,
  expected_path TEXT NOT NULL,
  reasons       TEXT[] NOT NULL,
  english_title TEXT,
  year          INTEGER,
  season_number INTEGER,
  episode_number INTEGER,
  status        TEXT NOT NULL DEFAULT 'pending',
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at    TIMESTAMPTZ
);

CREATE INDEX naming_audit_items_run_idx ON naming_audit_items(audit_run_id);
CREATE INDEX naming_audit_items_status_idx ON naming_audit_items(status);
