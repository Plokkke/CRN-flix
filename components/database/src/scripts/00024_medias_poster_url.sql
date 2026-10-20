-- Artwork URL as the metadata source hands it, so the engine no longer knows how a
-- provider builds its image URLs. Backfilled from the TMDB poster paths (w342, the size
-- the engine displayed). poster_path stays for the previous release (rollback) and is
-- to be dropped in a later migration.
ALTER TABLE medias ADD COLUMN poster_url VARCHAR(512);

UPDATE medias SET poster_url = 'https://image.tmdb.org/t/p/w342' || poster_path WHERE poster_path IS NOT NULL;
