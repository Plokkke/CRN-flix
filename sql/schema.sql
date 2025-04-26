-- =============================================
-- DATABASE SCHEMA
-- =============================================

-- =============================================
-- UTILITY FUNCTIONS
-- =============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- =============================================
-- TABLES
-- =============================================

-- =============================================
-- USERS
-- =============================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    name VARCHAR(255) NOT NULL,
    jellyfin_id VARCHAR(255),
    messaging_key VARCHAR(255) NOT NULL,
    messaging_id VARCHAR(255) NOT NULL,
    approval_message_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (jellyfin_id),
    UNIQUE (messaging_key, messaging_id),
    UNIQUE (approval_message_id)
);

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- USER ACTIVITIES
-- =============================================

CREATE TABLE IF NOT EXISTS user_activities (
    user_id UUID REFERENCES users (id) ON DELETE CASCADE,
    type VARCHAR(64) NOT NULL CHECK (
        type IN (
            'WATCHLISTED',
            'LISTED',
            'HIGH_RATED',
            'PROGRESS'
        )
    ),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, type)
);

CREATE TRIGGER update_user_activities_updated_at
  BEFORE UPDATE ON user_activities
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- MEDIA
-- =============================================

CREATE TABLE IF NOT EXISTS medias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    imdb_id VARCHAR(32) NOT NULL,
    type VARCHAR(64) NOT NULL CHECK (type IN ('movie', 'episode')),
    title VARCHAR(255) NOT NULL,
    year INTEGER,
    season_number INTEGER,
    episode_number INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX medias_unique_idx ON medias (
    imdb_id,
    COALESCE(season_number, -1),
    COALESCE(episode_number, -1)
);

CREATE TRIGGER update_medias_updated_at
  BEFORE UPDATE ON medias
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- MEDIA REQUESTS
-- =============================================

CREATE TABLE IF NOT EXISTS media_requests (
    media_id UUID PRIMARY KEY REFERENCES medias (id) ON DELETE CASCADE,
    status VARCHAR(64) NOT NULL DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'fulfilled',
            'missing',
            'rejected',
            'canceled'
        )
    ),
    thread_id VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_media_requests_updated_at
  BEFORE UPDATE ON media_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- REQUEST USERS
-- =============================================

CREATE TABLE IF NOT EXISTS request_users (
    request_media_id UUID REFERENCES media_requests (media_id) ON DELETE CASCADE,
    user_id UUID REFERENCES users (id) ON DELETE CASCADE,
    reasons VARCHAR(64)[] NOT NULL CHECK (
        array_position(reasons, 'WATCHLISTED') IS NOT NULL OR
        array_position(reasons, 'LISTED') IS NOT NULL OR
        array_position(reasons, 'HIGH_RATED') IS NOT NULL OR
        array_position(reasons, 'PROGRESS') IS NOT NULL
    ),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (request_media_id, user_id)
);

CREATE TRIGGER update_request_users_updated_at
  BEFORE UPDATE ON request_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- NOTIFICATION FUNCTIONS
-- =============================================

-- =============================================
-- REQUEST CREATED NOTIFICATION
-- =============================================

CREATE OR REPLACE FUNCTION notify_request_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'request_created',
    json_build_object(
      'requestId', NEW.media_id
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER request_created_trigger
  AFTER INSERT ON media_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_request_created();

-- =============================================
-- REQUEST STATUS CHANGE NOTIFICATION
-- =============================================

CREATE OR REPLACE FUNCTION notify_request_status_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'request_status_changed',
    json_build_object(
      'requestId', NEW.media_id,
      'oldStatus', OLD.status,
      'newStatus', NEW.status
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER request_status_change_trigger
  AFTER UPDATE OF status ON media_requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION notify_request_status_change();

-- =============================================
-- REQUEST USER ADDED NOTIFICATION
-- =============================================

CREATE OR REPLACE FUNCTION notify_user_joined_request()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'user_joined_request',
    json_build_object(
      'requestId', NEW.request_media_id,
      'userId', NEW.user_id
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_joined_request_trigger
  AFTER INSERT ON request_users
  FOR EACH ROW
  EXECUTE FUNCTION notify_user_joined_request();

-- =============================================
-- REQUEST USER REMOVED NOTIFICATION
-- =============================================

CREATE OR REPLACE FUNCTION notify_user_left_request()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'user_left_request',
    json_build_object(
      'requestId', OLD.request_media_id,
      'userId', OLD.user_id
    )::text
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_left_request_trigger
  AFTER DELETE ON request_users
  FOR EACH ROW
  EXECUTE FUNCTION notify_user_left_request();