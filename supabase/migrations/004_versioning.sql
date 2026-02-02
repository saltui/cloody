-- Document Versioning Migration
-- Version: 004
-- Description: Add document version history tracking

BEGIN;

-- Create document_versions table
CREATE TABLE document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    url VARCHAR NOT NULL,
    file_size BIGINT,
    file_hash VARCHAR(64),
    change_reason VARCHAR(500),
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_photo_version UNIQUE (photo_id, version_number)
);

-- Add indexes for common queries
CREATE INDEX idx_document_versions_photo_id ON document_versions(photo_id);
CREATE INDEX idx_document_versions_changed_by ON document_versions(changed_by);
CREATE INDEX idx_document_versions_created_at ON document_versions(created_at DESC);

-- Alter photos table to add version and security columns
ALTER TABLE photos
    ADD COLUMN IF NOT EXISTS current_version_id UUID REFERENCES document_versions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS security_level_id UUID REFERENCES security_levels(id) ON DELETE SET NULL;

-- Add index on security_level_id for filtering queries
CREATE INDEX IF NOT EXISTS idx_photos_security_level_id ON photos(security_level_id);

-- Add comments for documentation
COMMENT ON TABLE document_versions IS 'Stores version history for documents with R2 URLs';
COMMENT ON COLUMN document_versions.version_number IS 'Sequential version number starting from 1';
COMMENT ON COLUMN document_versions.file_hash IS 'SHA-256 hash for version integrity verification';
COMMENT ON COLUMN document_versions.change_reason IS 'User-provided reason for this version change';
COMMENT ON COLUMN photos.current_version_id IS 'Points to the active version of this document';
COMMENT ON COLUMN photos.security_level_id IS 'Document security classification level';

COMMIT;
