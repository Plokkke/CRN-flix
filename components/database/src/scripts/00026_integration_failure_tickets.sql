-- integration-failure: an integration (catalog, indexer) stopped matching its API and the
-- admin has to adapt its plugin. Subject = ('integration', '<integration>:<operation>').
ALTER TABLE tickets DROP CONSTRAINT tickets_category_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_category_check CHECK (category IN
  ('user-approval','download-action','identification-failure',
   'pipeline-failure','manual-download','missing-imdb','integration-failure'));
