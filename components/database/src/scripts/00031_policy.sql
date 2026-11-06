-- The profile decides which shared shelves an account sees (adult: every shelf, kids: the kids
-- shelf); chosen when an admin approves the registration.
ALTER TABLE users ADD COLUMN profile VARCHAR(16) NOT NULL DEFAULT 'adult' CHECK (profile IN ('adult', 'kids'));

-- A concrete rule: a kind (the plugin's code) with params validated by that kind's schema.
-- `audience` is 'everyone' (refused on every shelf) or the key of the shelf the rule admits to.
CREATE TABLE policy_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(128) NOT NULL,
  kind VARCHAR(64) NOT NULL,
  audience VARCHAR(32) NOT NULL,
  params JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A rule's list (people, titles…), each entry validated by the kind's entry schema.
CREATE TABLE policy_rule_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES policy_rules(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX policy_rule_entries_rule ON policy_rule_entries (rule_id);

-- A title let through despite a rule: for one user (their personal shelf) or for everyone
-- (user_id NULL), from one rule or every rule (rule_id NULL).
CREATE TABLE policy_exemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  imdb_id VARCHAR(32) NOT NULL,
  rule_id UUID REFERENCES policy_rules(id) ON DELETE CASCADE,
  origin VARCHAR(32) NOT NULL CHECK (origin IN ('contest', 'exemption', 'manual-download', 'admin')),
  status VARCHAR(16) NOT NULL CHECK (status IN ('pending', 'granted', 'denied')),
  motivation TEXT,
  ticket_id UUID,
  decided_by VARCHAR(128),
  decided_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX policy_exemptions_granted ON policy_exemptions (imdb_id) WHERE status = 'granted';

-- Every enabled rule judged against one title's content; `fingerprint` identifies the rules
-- (and their entries) it was computed with, so a rule change marks every assessment stale.
CREATE TABLE policy_assessments (
  imdb_id VARCHAR(32) PRIMARY KEY,
  outcomes JSONB NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  assessed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
