-- A player account the admin takes in (no catalog link, no messaging channel): administered
-- like any subscriber (profile, streams, personal shelf), but nobody to notify and no /me login.
ALTER TABLE users ALTER COLUMN messaging_key DROP NOT NULL;
ALTER TABLE users ALTER COLUMN messaging_id DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_messaging_pair CHECK ((messaging_key IS NULL) = (messaging_id IS NULL));

-- The Discord admin this account belongs to: what that admin keeps for themselves (a manual
-- download sent to « Ma collection ») goes to this account's personal shelf.
ALTER TABLE users ADD COLUMN admin_discord_id VARCHAR(64) UNIQUE;
