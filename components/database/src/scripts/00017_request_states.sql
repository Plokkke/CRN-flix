-- Request states: the planner's read model, one row per missing media, rewritten at the
-- end of every pass. Nothing here is a source of truth — it is the last observed answer
-- to "why is this still missing?" so the admin dashboard needs no indexer call.
--
-- Axes (see knowledge/download-planner-brief.md and CLAUDE.md):
--   urgency   starved | needed | deferred        — from playheads and viewing windows
--   sourcing  available | non-compliant | unavailable | not-indexed | not-referenced
--             available      a candidate passes the preferences
--             non-compliant  best candidate fails only on quality/size (forceable)
--             unavailable    every candidate fails on host/language (nothing to force)
--             not-indexed    the indexer has the show but not this episode
--             not-referenced no indexer has the show at all

CREATE TABLE media_request_states (
  media_id UUID PRIMARY KEY REFERENCES medias(id) ON DELETE CASCADE,
  urgency VARCHAR(16) NOT NULL CHECK (urgency IN ('starved','needed','deferred')),
  sourcing VARCHAR(16) NOT NULL
    CHECK (sourcing IN ('available','non-compliant','unavailable','not-indexed','not-referenced')),
  -- Best eligible candidate (IndexerCandidate) and best rejected one ({candidate, reasons}).
  best_candidate JSONB,
  best_rejected JSONB,
  action_id UUID REFERENCES planned_downloads(id) ON DELETE SET NULL,
  planned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_request_states_sourcing ON media_request_states (sourcing);

-- Admin decision to relax preferences for one planner target ("show:tt…" or "movie:<uuid>"),
-- so a non-compliant candidate becomes eligible. Removed by the admin, never expires.
CREATE TABLE planner_overrides (
  target_key VARCHAR(64) PRIMARY KEY,
  relax_quality BOOLEAN NOT NULL DEFAULT false,
  relax_size BOOLEAN NOT NULL DEFAULT false,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
