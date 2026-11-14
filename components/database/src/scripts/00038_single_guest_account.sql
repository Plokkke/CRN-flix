-- There is one guest account (the player's shared « Invité »), and it is never reached by messaging.
CREATE UNIQUE INDEX users_single_guest ON users (guest) WHERE guest;
ALTER TABLE users ADD CONSTRAINT users_guest_without_messaging CHECK (NOT guest OR messaging_key IS NULL);
