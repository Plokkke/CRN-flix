-- Download jobs pipeline table

CREATE TYPE download_job_status AS ENUM (
  'detected',
  'identifying',
  'completed',
  'failed'
);

CREATE TABLE download_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jdownloader_package_id BIGINT NOT NULL UNIQUE,
  package_name TEXT NOT NULL,
  save_to TEXT NOT NULL,
  status download_job_status NOT NULL DEFAULT 'detected',
  source_paths TEXT[] NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_download_jobs_status ON download_jobs(status);

-- FK from media_requests to download_jobs
ALTER TABLE media_requests
  ADD COLUMN download_job_id UUID REFERENCES download_jobs(id) ON DELETE SET NULL;

CREATE TRIGGER update_download_jobs_updated_at
  BEFORE UPDATE ON download_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Notify on insert
CREATE OR REPLACE FUNCTION notify_download_job_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'download_job_created',
    json_build_object(
      'jobId', NEW.id
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER download_job_created_trigger
  AFTER INSERT ON download_jobs
  FOR EACH ROW
  EXECUTE FUNCTION notify_download_job_created();

-- Notify on status change
CREATE OR REPLACE FUNCTION notify_download_job_status_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'download_job_status_changed',
    json_build_object(
      'jobId', NEW.id,
      'oldStatus', OLD.status,
      'newStatus', NEW.status
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER download_job_status_change_trigger
  AFTER UPDATE OF status ON download_jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION notify_download_job_status_change();
