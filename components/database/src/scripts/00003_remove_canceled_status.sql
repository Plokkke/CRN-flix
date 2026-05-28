-- Remove 'canceled' status: requests are now deleted when last user leaves
-- First delete any existing canceled requests
DELETE FROM media_requests WHERE status = 'canceled';

-- Remove 'canceled' from the CHECK constraint
ALTER TABLE media_requests DROP CONSTRAINT IF EXISTS media_requests_status_check;
ALTER TABLE media_requests ADD CONSTRAINT media_requests_status_check
    CHECK (status IN ('pending', 'fulfilled', 'missing', 'rejected'));
