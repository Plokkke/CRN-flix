-- user_notifications becomes an outbox: a row is queued unsent (sent_at NULL) and only
-- marked sent once the channel delivered it, so a failed or interrupted send is retried
-- instead of being lost. Existing rows were sent and keep their sent_at.
ALTER TABLE user_notifications ALTER COLUMN sent_at DROP DEFAULT;
ALTER TABLE user_notifications ADD COLUMN queued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS user_notifications_pending_idx ON user_notifications (queued_at) WHERE sent_at IS NULL;
