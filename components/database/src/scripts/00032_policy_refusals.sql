-- A title the policies refuse to one requester (POLICY_MODE=enforce): what they are told
-- (`refusals`, the rules' notices), whether they were told (`notified_at`, set once a channel
-- delivered it) and whether it still holds (`lifted_at`: an exemption, a rule change).
CREATE TABLE policy_refusals (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  imdb_id VARCHAR(32) NOT NULL,
  refusals JSONB NOT NULL,
  refused_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notified_at TIMESTAMP WITH TIME ZONE,
  lifted_at TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (user_id, imdb_id)
);

CREATE INDEX policy_refusals_to_notify ON policy_refusals (refused_at) WHERE notified_at IS NULL AND lifted_at IS NULL;
