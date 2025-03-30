DROP TABLE IF EXISTS media_requests_users;

DROP TABLE IF EXISTS users;

DROP TABLE IF EXISTS media_requests;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    name VARCHAR(255) NOT NULL,
    jellyfin_id VARCHAR(255) UNIQUE,
    messaging_key VARCHAR(255) NOT NULL,
    messaging_id VARCHAR(255) NOT NULL,
    request_message_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (messaging_key, messaging_id)
);

CREATE TABLE IF NOT EXISTS media_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    imdb_id VARCHAR(32) NOT NULL,
    status VARCHAR(64) NOT NULL CHECK (
        status IN (
            'pending',
            'in_progress',
            'fulfilled',
            'missing',
            'rejected',
            'canceled'
        )
    ),
    type VARCHAR(64) NOT NULL CHECK (type IN ('movie', 'episode')),
    title VARCHAR(255) NOT NULL,
    year INTEGER,
    season_number INTEGER,
    episode_number INTEGER,
    thread_id VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX media_requests_unique_idx ON media_requests (
    imdb_id,
    COALESCE(season_number, -1),
    COALESCE(episode_number, -1)
);

CREATE TABLE IF NOT EXISTS media_requests_users (
    media_request_id UUID REFERENCES media_requests (id) ON DELETE CASCADE,
    user_id UUID REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (media_request_id, user_id)
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON users;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_media_requests_updated_at ON media_requests;

CREATE TRIGGER update_media_requests_updated_at
  BEFORE UPDATE ON media_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION notify_media_request_status_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'media_request_status_change',
    json_build_object(
      'requestId', NEW.id,
      'oldStatus', OLD.status,
      'newStatus', NEW.status
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS media_request_status_change_trigger ON media_requests;

CREATE TRIGGER media_request_status_change_trigger
  AFTER UPDATE OF status ON media_requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION notify_media_request_status_change();