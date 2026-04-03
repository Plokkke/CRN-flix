-- Add discord error message tracking for download jobs
ALTER TABLE download_jobs
  ADD COLUMN discord_error_message_id TEXT;

-- Add original_title to medias for Darkiworld search
ALTER TABLE medias
  ADD COLUMN original_title VARCHAR(255);
