-- Admin dashboard sessions: opaque tokens issued after a Discord OTP challenge.
-- Only the SHA-256 hash of the token is stored, so a database dump cannot be replayed.

CREATE TABLE admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  discord_user_id VARCHAR(64) NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_admin_sessions_token_hash ON admin_sessions (token_hash);
