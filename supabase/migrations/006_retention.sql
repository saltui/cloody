-- Migration: Retention Policies and Disposal Management
-- Description: Add retention policy support for automated photo lifecycle management

-- Create retention_policies table
CREATE TABLE retention_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR NOT NULL,
    retention_days INTEGER NOT NULL CHECK (retention_days > 0),
    action VARCHAR NOT NULL CHECK (action IN ('archive', 'delete', 'review')),
    requires_approval BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_policy_name_per_org UNIQUE (org_id, name)
);

-- Add retention columns to photos table
ALTER TABLE photos
ADD COLUMN retention_policy_id UUID REFERENCES retention_policies(id) ON DELETE SET NULL,
ADD COLUMN retention_expires_at TIMESTAMPTZ,
ADD COLUMN disposal_status VARCHAR CHECK (disposal_status IN ('pending', 'approved', 'disposed'));

-- Create disposal_requests table
CREATE TABLE disposal_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason VARCHAR,
    status VARCHAR DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX idx_retention_policies_org_id ON retention_policies(org_id);
CREATE INDEX idx_photos_retention_policy_id ON photos(retention_policy_id);
CREATE INDEX idx_photos_retention_expires_at ON photos(retention_expires_at) WHERE retention_expires_at IS NOT NULL;
CREATE INDEX idx_photos_disposal_status ON photos(disposal_status) WHERE disposal_status IS NOT NULL;
CREATE INDEX idx_disposal_requests_photo_id ON disposal_requests(photo_id);
CREATE INDEX idx_disposal_requests_status ON disposal_requests(status);
CREATE INDEX idx_disposal_requests_requested_by ON disposal_requests(requested_by);
CREATE INDEX idx_disposal_requests_approved_by ON disposal_requests(approved_by) WHERE approved_by IS NOT NULL;

-- Add comments for documentation
COMMENT ON TABLE retention_policies IS 'Defines retention policies for photo lifecycle management';
COMMENT ON COLUMN retention_policies.retention_days IS 'Number of days to retain photos before action is triggered';
COMMENT ON COLUMN retention_policies.action IS 'Action to take when retention period expires: archive, delete, or review';
COMMENT ON COLUMN retention_policies.requires_approval IS 'Whether disposal requires manual approval';

COMMENT ON TABLE disposal_requests IS 'Tracks manual and automatic disposal requests for photos';
COMMENT ON COLUMN disposal_requests.status IS 'Current status of the disposal request: pending, approved, rejected, or completed';

COMMENT ON COLUMN photos.retention_policy_id IS 'Associated retention policy for this photo';
COMMENT ON COLUMN photos.retention_expires_at IS 'Timestamp when retention period expires and action should be taken';
COMMENT ON COLUMN photos.disposal_status IS 'Current disposal workflow status: null (not scheduled), pending (awaiting approval), approved (ready for disposal), disposed (completed)';
