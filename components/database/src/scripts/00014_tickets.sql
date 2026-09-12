-- Admin tickets: generic, channel-agnostic ledger of every process that needs a human.
-- Adapters (Discord, web dashboard) render tickets and translate interactions into
-- operations; they never own state. Bindings map a ticket to its adapter-side artifacts.

-- =============================================
-- TICKETS
-- =============================================

CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(32) NOT NULL CHECK (category IN
    ('user-approval','download-action','identification-failure',
     'pipeline-failure','manual-download','missing-imdb')),
  subject_type VARCHAR(32),  -- 'user' | 'planned_download' | 'download_job' | 'show' | 'media'
  subject_id VARCHAR(64),    -- no FK: the ticket must survive its subject's deletion
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','abandoned')),
  title TEXT NOT NULL,
  summary TEXT,
  payload JSONB NOT NULL DEFAULT '{}',  -- category-specific resume state
  attempts INT NOT NULL DEFAULT 0,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- At most one OPEN ticket per (category, subject). Subject-less tickets (manual-download)
-- deliberately escape the uniqueness.
CREATE UNIQUE INDEX tickets_open_subject_uidx
  ON tickets (category, subject_type, subject_id)
  WHERE status = 'open' AND subject_id IS NOT NULL;

CREATE INDEX tickets_open_idx ON tickets (status) WHERE status = 'open';

CREATE TRIGGER update_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- TIMELINE
-- =============================================

CREATE TABLE ticket_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL,   -- created|admin-message|operation|attempt-failed|resolved|abandoned|note
  actor VARCHAR(80) NOT NULL,  -- 'system' | 'discord:<userId>' | 'dashboard:<discordUserId>'
  message TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',  -- e.g. { "origin": "discord" } to avoid echoing back
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ticket_events_ticket_idx ON ticket_events (ticket_id, created_at);

-- =============================================
-- ADAPTER BINDINGS (which external artifact materializes a ticket)
-- =============================================

CREATE TABLE ticket_bindings (
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  adapter VARCHAR(16) NOT NULL,  -- 'discord'
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('root','thread')),
  external_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, adapter, kind)
);

-- Reverse lookup (reply/button → ticket) and guarantee a message maps to one ticket only.
CREATE UNIQUE INDEX ticket_bindings_external_uidx ON ticket_bindings (adapter, external_id);

-- =============================================
-- TICKET NOTIFICATIONS
-- =============================================

CREATE OR REPLACE FUNCTION notify_ticket_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'ticket_created',
    json_build_object(
      'ticketId', NEW.id
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_created_trigger
  AFTER INSERT ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION notify_ticket_created();

CREATE OR REPLACE FUNCTION notify_ticket_status_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'ticket_status_changed',
    json_build_object(
      'ticketId', NEW.id,
      'oldStatus', OLD.status,
      'newStatus', NEW.status
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_status_change_trigger
  AFTER UPDATE OF status ON tickets
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION notify_ticket_status_change();

CREATE OR REPLACE FUNCTION notify_ticket_event_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'ticket_event_created',
    json_build_object(
      'ticketId', NEW.ticket_id,
      'eventId', NEW.id,
      'kind', NEW.kind
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_event_created_trigger
  AFTER INSERT ON ticket_events
  FOR EACH ROW
  EXECUTE FUNCTION notify_ticket_event_created();

-- =============================================
-- DISCORD MESSAGE IDS LEAVE THE BUSINESS TABLES (bindings replace them)
-- =============================================

ALTER TABLE users DROP COLUMN discord_message_id;
ALTER TABLE download_jobs DROP COLUMN discord_message_id;

-- Approval state used to live implicitly in Discord (pending = an approval message with
-- buttons). Make it explicit; existing users with a Jellyfin account are active.
ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','active'));
UPDATE users SET status = 'active' WHERE jellyfin_id IS NOT NULL;
