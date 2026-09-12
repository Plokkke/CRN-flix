-- Download planner: intent/plan separation.
-- Observations (user_show_progress) and the materialized plan (planned_downloads) are the
-- only persisted state; labels and plans are recomputed by the planner on every pass.

-- =============================================
-- OBSERVATION: playhead per user × show (fed by trakt-sync progress fetch)
-- =============================================

CREATE TABLE user_show_progress (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  show_imdb_id VARCHAR(32) NOT NULL,
  next_season INT,          -- NULL = show completed by this user
  next_episode INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, show_imdb_id)
);

CREATE OR REPLACE FUNCTION notify_user_show_progress_changed()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'user_show_progress_changed',
    json_build_object(
      'userId', NEW.user_id,
      'showImdbId', NEW.show_imdb_id
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_show_progress_changed_trigger
  AFTER INSERT OR UPDATE ON user_show_progress
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION notify_user_show_progress_changed();

-- =============================================
-- THE MATERIALIZED PLAN
-- =============================================

CREATE TABLE planned_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_imdb_id VARCHAR(32),               -- NULL for movies
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('movie','episode','season','series')),
  season_number INT,
  episode_number INT,
  indexer_name TEXT NOT NULL,
  url TEXT NOT NULL,
  quality VARCHAR(16) NOT NULL,
  language VARCHAR(16) NOT NULL,
  size_bytes BIGINT,
  label VARCHAR(16) NOT NULL CHECK (label IN ('starved','needed','deferred')),
  status VARCHAR(16) NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','downloading','done','superseded','expired')),
  -- Runner-up candidates shown to the admin so he can arbitrate the action count himself.
  alternatives JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX planned_downloads_live_idx ON planned_downloads (status)
  WHERE status IN ('proposed', 'downloading');
CREATE INDEX planned_downloads_show_idx ON planned_downloads (show_imdb_id);

CREATE TRIGGER update_planned_downloads_updated_at
  BEFORE UPDATE ON planned_downloads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- coverage: which intent episodes/movies an action satisfies
CREATE TABLE planned_download_medias (
  planned_download_id UUID NOT NULL REFERENCES planned_downloads(id) ON DELETE CASCADE,
  media_id UUID NOT NULL REFERENCES medias(id) ON DELETE CASCADE,
  PRIMARY KEY (planned_download_id, media_id)
);

CREATE INDEX planned_download_medias_media_idx ON planned_download_medias (media_id);

-- =============================================
-- PLAN NOTIFICATIONS
-- =============================================

CREATE OR REPLACE FUNCTION notify_planned_download_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'planned_download_created',
    json_build_object(
      'actionId', NEW.id
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER planned_download_created_trigger
  AFTER INSERT ON planned_downloads
  FOR EACH ROW
  EXECUTE FUNCTION notify_planned_download_created();

CREATE OR REPLACE FUNCTION notify_planned_download_status_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'planned_download_status_changed',
    json_build_object(
      'actionId', NEW.id,
      'oldStatus', OLD.status,
      'newStatus', NEW.status
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER planned_download_status_change_trigger
  AFTER UPDATE OF status ON planned_downloads
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION notify_planned_download_status_change();

CREATE OR REPLACE FUNCTION notify_planned_download_label_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'planned_download_label_changed',
    json_build_object(
      'actionId', NEW.id,
      'oldLabel', OLD.label,
      'newLabel', NEW.label
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER planned_download_label_change_trigger
  AFTER UPDATE OF label ON planned_downloads
  FOR EACH ROW
  WHEN (OLD.label IS DISTINCT FROM NEW.label)
  EXECUTE FUNCTION notify_planned_download_label_change();

-- =============================================
-- DEPRECATED media_requests COLUMNS (fix-forward, no rollback path)
-- =============================================

-- The winning link now lives on the action; per-episode admin embeds are replaced by
-- per-action embeds (legacy embeds are purged by hand at deploy).
ALTER TABLE media_requests DROP COLUMN IF EXISTS indexer_name;
ALTER TABLE media_requests DROP COLUMN IF EXISTS indexer_link;
ALTER TABLE media_requests DROP COLUMN IF EXISTS discord_message_id;
