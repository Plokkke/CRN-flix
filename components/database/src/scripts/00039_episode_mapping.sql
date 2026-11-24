-- A show whose releases are numbered differently from the catalog: its downloads are not placed,
-- they wait in the download folder until the admin tells which episodes each file holds.
CREATE TABLE manual_numbering (
  imdb_id VARCHAR(16) PRIMARY KEY,
  set_by TEXT NOT NULL,
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TYPE download_job_status ADD VALUE IF NOT EXISTS 'awaiting-mapping';

-- The show a parked job's files belong to (set when it parks).
ALTER TABLE download_jobs ADD COLUMN mapping_imdb_id VARCHAR(16);
CREATE INDEX idx_download_jobs_mapping ON download_jobs (mapping_imdb_id) WHERE mapping_imdb_id IS NOT NULL;

ALTER TABLE tickets DROP CONSTRAINT tickets_category_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_category_check CHECK (category IN
  ('user-approval','download-action','identification-failure','pipeline-failure','manual-download',
   'missing-imdb','integration-failure','policy-appeal','policy-anomaly','episode-mapping'));
