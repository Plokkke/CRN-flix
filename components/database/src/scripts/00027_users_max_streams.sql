-- How many streams a user may watch at once on the player (0 = unlimited): a family shares
-- one account, a single viewer does not. Existing users stay NULL until the engine adopts
-- what their player account already allows; new users start with one stream.
ALTER TABLE users ADD COLUMN max_streams INTEGER CHECK (max_streams >= 0);
ALTER TABLE users ALTER COLUMN max_streams SET DEFAULT 1;
