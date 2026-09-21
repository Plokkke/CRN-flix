-- Every name the engine knows for a media, so indexers get the full picture and users
-- see the French title. `title` stays the English (canonical) one; `original_title`
-- becomes the real original-language title once TMDB has been consulted.
ALTER TABLE medias
  ADD COLUMN french_title VARCHAR(255),
  ADD COLUMN original_language VARCHAR(8);
