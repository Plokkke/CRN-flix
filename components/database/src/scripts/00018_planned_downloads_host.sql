-- The host of the chosen release, so a live proposal can be re-assessed against the
-- current preferences on every planner pass (a proposal made under looser rules, or
-- before a runtime was known, must not survive as if the admin had chosen it).
-- 1fichier is the only host ever handled so far, hence the backfill default.

ALTER TABLE planned_downloads ADD COLUMN host VARCHAR(32) NOT NULL DEFAULT '1fichier';
