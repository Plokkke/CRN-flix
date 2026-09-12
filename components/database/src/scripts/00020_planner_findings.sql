-- Planner findings: every release the indexers returned for a target, assessed against
-- the preferences (reasons kept), rewritten on each pass. Lets the dashboards show the
-- best releases and let the admin launch one without querying the indexers again.

CREATE TABLE planner_findings (
  target_key VARCHAR(64) PRIMARY KEY,
  candidates JSONB NOT NULL DEFAULT '[]',
  referenced BOOLEAN NOT NULL DEFAULT false,
  found_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
