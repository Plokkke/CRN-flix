-- Generic indexer model: replace darkiworld-specific columns and enable size policy.

ALTER TABLE medias ADD COLUMN IF NOT EXISTS runtime_minutes INTEGER;

ALTER TABLE media_requests ADD COLUMN IF NOT EXISTS indexer_name TEXT;
ALTER TABLE media_requests ADD COLUMN IF NOT EXISTS indexer_link TEXT;

ALTER TABLE media_requests DROP COLUMN IF EXISTS darkiworld_title_id;
ALTER TABLE media_requests DROP COLUMN IF EXISTS darkiworld_url;

-- Indexer registry is empty until a new indexer is integrated; no link can be considered valid.
UPDATE media_requests SET status = 'missing', updated_at = NOW() WHERE status = 'pending';
