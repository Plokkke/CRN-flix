-- What the store holds (LIBRARY_LAYOUT=shelves): one row per title folder, the only copy of
-- its files; every library (shelf) is a set of symbolic links to these folders.
CREATE TABLE library_titles (
  section VARCHAR(16) NOT NULL CHECK (section IN ('movies', 'series')),
  folder VARCHAR(512) NOT NULL,
  imdb_id VARCHAR(32) NOT NULL,
  placed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (section, folder)
);

CREATE INDEX library_titles_imdb ON library_titles (imdb_id);

-- The admin's choice of shared shelf for a title, which prevails over the rules: a shelf key,
-- or 'none' (kept off the shared shelves, e.g. an admin's personal download).
CREATE TABLE shelf_overrides (
  imdb_id VARCHAR(32) PRIMARY KEY,
  shelf VARCHAR(32) NOT NULL,
  origin VARCHAR(32) NOT NULL CHECK (origin IN ('admin', 'manual-download')),
  decided_by VARCHAR(128),
  decided_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
