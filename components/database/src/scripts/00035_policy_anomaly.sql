-- policy-anomaly: a title on a shared shelf now breaks a rule for everyone. Until an admin
-- decides, a shelf override (origin 'anomaly') keeps it where it was. Subject = ('media', imdb id).
ALTER TABLE tickets DROP CONSTRAINT tickets_category_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_category_check CHECK (category IN
  ('user-approval','download-action','identification-failure','pipeline-failure','manual-download',
   'missing-imdb','integration-failure','policy-appeal','policy-anomaly'));

ALTER TABLE shelf_overrides DROP CONSTRAINT shelf_overrides_origin_check;
ALTER TABLE shelf_overrides ADD CONSTRAINT shelf_overrides_origin_check CHECK (origin IN ('admin', 'manual-download', 'anomaly'));
