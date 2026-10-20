-- Journal of the messages a channel actually delivered to a user (never written in dry-run
-- nor on a failed send): what the admin page counts to spot a user being flooded.
CREATE TABLE user_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL,
  channel VARCHAR(32) NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX user_messages_user_kind_sent_at ON user_messages (user_id, kind, sent_at);

-- Set once the user was asked to link their catalog account again (at most one ask per
-- revocation), cleared when the account works again.
ALTER TABLE users ADD COLUMN catalog_relink_requested_at TIMESTAMP WITH TIME ZONE;
