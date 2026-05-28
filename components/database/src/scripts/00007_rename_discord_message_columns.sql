-- Uniform discord message ID column naming

ALTER TABLE users
  RENAME COLUMN approval_message_id TO discord_message_id;

ALTER TABLE media_requests
  RENAME COLUMN thread_id TO discord_message_id;

ALTER TABLE download_jobs
  RENAME COLUMN discord_error_message_id TO discord_message_id;
