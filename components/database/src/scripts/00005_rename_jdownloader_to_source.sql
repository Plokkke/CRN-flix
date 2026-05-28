-- Rename jdownloader_package_id to source_id and change type to TEXT

ALTER TABLE download_jobs
  ALTER COLUMN jdownloader_package_id TYPE TEXT USING jdownloader_package_id::TEXT;

ALTER TABLE download_jobs
  RENAME COLUMN jdownloader_package_id TO source_id;
