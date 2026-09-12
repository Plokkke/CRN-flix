-- Indexer bookmarks: what an indexer wants remembered about one media (imdb id).
-- The engine only stores and hands back; `state` is the indexer's own and never
-- interpreted here. `page_url` / `search_url` are the generic human links the admin
-- dashboard shows (the media's page when matched, a manual search otherwise).

CREATE TABLE indexer_bookmarks (
  indexer_name VARCHAR(64) NOT NULL,
  imdb_id VARCHAR(32) NOT NULL,
  page_url TEXT,
  search_url TEXT,
  state JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (indexer_name, imdb_id)
);

CREATE INDEX idx_indexer_bookmarks_imdb_id ON indexer_bookmarks (imdb_id);
