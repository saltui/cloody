-- Transcoding jobs queue table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS transcoding_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'pending',
  -- Possible values: 'pending', 'processing', 'completed', 'failed'
  attempts INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(photo_id)
);

-- Index for finding pending jobs
CREATE INDEX IF NOT EXISTS idx_transcoding_jobs_status ON transcoding_jobs(status) WHERE status IN ('pending', 'processing');

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_transcoding_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transcoding_jobs_updated_at ON transcoding_jobs;
CREATE TRIGGER transcoding_jobs_updated_at
  BEFORE UPDATE ON transcoding_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_transcoding_jobs_updated_at();
