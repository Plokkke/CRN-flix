-- What the metadata source knows about a title beyond its names (credits, genres, ratings…),
-- one row per imdb id: what policies evaluate. `facts` is NULL when the source does not know
-- the title; `schema_version` lets the engine refetch rows written in an older shape.
CREATE TABLE media_facts (
  imdb_id VARCHAR(32) PRIMARY KEY,
  facts JSONB,
  schema_version SMALLINT NOT NULL,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX media_facts_fetched_at ON media_facts (fetched_at);
