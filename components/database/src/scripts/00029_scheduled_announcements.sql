-- Announcements to subscribers, sent at a chosen time (never inside quiet hours: the engine
-- bumps `send_at` when saving and checks again when sending). `sent_at` is set when the
-- sending starts (claimed once, never sent twice), `outcomes` once every recipient was tried.
CREATE TABLE scheduled_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  title TEXT NOT NULL,
  tone VARCHAR(16) NOT NULL,
  paragraphs JSONB NOT NULL,
  cta JSONB,
  user_ids UUID[] NOT NULL,
  send_at TIMESTAMP WITH TIME ZONE NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  outcomes JSONB,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX scheduled_announcements_due ON scheduled_announcements (send_at)
  WHERE sent_at IS NULL AND cancelled_at IS NULL;
