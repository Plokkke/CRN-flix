DROP TABLE IF EXISTS media_requests_users;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS media_requests;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  jellyfin_id VARCHAR(255) UNIQUE,
  messaging_key VARCHAR(255) NOT NULL,
  messaging_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(messaging_key, messaging_id)
);

CREATE TABLE IF NOT EXISTS media_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imdb_id VARCHAR(20) NOT NULL,
  status VARCHAR(10) NOT NULL CHECK (status IN ('missing', 'overaged')),
  type VARCHAR(10) NOT NULL CHECK (type IN ('movie', 'show', 'season', 'episode')),
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
  media_request_id UUID REFERENCES media_requests(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
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
DROP TRIGGER IF EXISTS update_media_requests_updated_at ON media_requests;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_media_requests_updated_at
  BEFORE UPDATE ON media_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();