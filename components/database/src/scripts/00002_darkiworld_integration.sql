-- Store Darkiworld title match and download URL on media requests
ALTER TABLE media_requests ADD COLUMN IF NOT EXISTS darkiworld_title_id INTEGER;
ALTER TABLE media_requests ADD COLUMN IF NOT EXISTS darkiworld_url TEXT;

-- New requests now start as 'missing' (not yet found on Darkiworld)
ALTER TABLE media_requests ALTER COLUMN status SET DEFAULT 'missing';
