-- TMDB poster path (e.g. "/4of8zx….jpg"), resolved alongside the titles: the poster URL
-- is built from it with no extra call (https://image.tmdb.org/t/p/<size><path>).
ALTER TABLE medias ADD COLUMN poster_path VARCHAR(255);
