-- Video metadata columns for HLS streaming support
-- Run this in Supabase SQL Editor

-- File metadata
ALTER TABLE photos ADD COLUMN IF NOT EXISTS file_type VARCHAR(50);
ALTER TABLE photos ADD COLUMN IF NOT EXISTS file_size BIGINT;

-- Video specific fields
ALTER TABLE photos ADD COLUMN IF NOT EXISTS is_video BOOLEAN DEFAULT false;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS duration INTEGER; -- seconds
ALTER TABLE photos ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS height INTEGER;

-- HLS streaming fields
ALTER TABLE photos ADD COLUMN IF NOT EXISTS hls_url TEXT;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS hls_status VARCHAR(20) DEFAULT 'not_applicable';
-- Possible values: 'not_applicable', 'pending', 'processing', 'ready', 'failed'

-- Create index for video queries
CREATE INDEX IF NOT EXISTS idx_photos_is_video ON photos(is_video) WHERE is_video = true;
CREATE INDEX IF NOT EXISTS idx_photos_hls_status ON photos(hls_status) WHERE hls_status IN ('pending', 'processing');

-- Update existing video files (based on file extension)
UPDATE photos
SET is_video = true, hls_status = 'pending'
WHERE url LIKE '%.mp4'
   OR url LIKE '%.mov'
   OR url LIKE '%.webm'
   OR url LIKE '%.avi'
   OR url LIKE '%.mkv';
