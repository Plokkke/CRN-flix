-- Trakt slug of the show/movie, for direct links (https://app.trakt.tv/shows/<slug>).
-- Filled by trakt-sync from the ids Trakt returns; existing rows heal on their next sync.

ALTER TABLE medias ADD COLUMN trakt_slug VARCHAR(255);
