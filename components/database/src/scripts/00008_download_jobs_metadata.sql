-- Add metadata storage for download jobs (Fetchr context propagation)
ALTER TABLE download_jobs ADD COLUMN metadata JSONB;
