-- A guest account (shared by visitors): sees the shelves of its profile, never a personal shelf.
ALTER TABLE users ADD COLUMN guest BOOLEAN NOT NULL DEFAULT FALSE;
