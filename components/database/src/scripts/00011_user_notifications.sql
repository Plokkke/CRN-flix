-- Track sent user notifications: at most one notification per (user, media, status).
-- Prevents duplicate "available" emails when request_users rows are recreated by Trakt sync.

CREATE TABLE IF NOT EXISTS user_notifications (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    media_id UUID NOT NULL REFERENCES medias (id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, media_id, status)
);

-- Seed with the current state: existing users are considered already notified,
-- so the first sync after this migration does not re-send everything once.
INSERT INTO user_notifications (user_id, media_id, status)
SELECT ru.user_id, mr.media_id, mr.status
FROM request_users ru
JOIN media_requests mr ON mr.media_id = ru.request_media_id
ON CONFLICT (user_id, media_id, status) DO NOTHING;
