-- policy-appeal: a subscriber contests a policy refusal or asks for an exemption.
-- Subject = ('policy_refusal', '<user id>:<imdb id>').
ALTER TABLE tickets DROP CONSTRAINT tickets_category_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_category_check CHECK (category IN
  ('user-approval','download-action','identification-failure',
   'pipeline-failure','manual-download','missing-imdb','integration-failure','policy-appeal'));
