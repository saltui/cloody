-- Enhanced Audit Logging Migration
-- Version: 005
-- Description: Add comprehensive audit columns and indexes for ISMS compliance

BEGIN;

-- Add new columns to audit_logs table for enhanced tracking
ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS resource_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS resource_id UUID,
    ADD COLUMN IF NOT EXISTS old_value JSONB,
    ADD COLUMN IF NOT EXISTS new_value JSONB,
    ADD COLUMN IF NOT EXISTS session_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(64),
    ADD COLUMN IF NOT EXISTS prev_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS log_hash VARCHAR(64);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_hash ON audit_logs(log_hash);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_logs(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_logs(action, created_at DESC);

-- Add comments for documentation
COMMENT ON COLUMN audit_logs.user_id IS 'User who performed the action';
COMMENT ON COLUMN audit_logs.org_id IS 'Organization context for the action';
COMMENT ON COLUMN audit_logs.resource_type IS 'Type of resource affected (document, folder, user, role, etc.)';
COMMENT ON COLUMN audit_logs.resource_id IS 'UUID of the affected resource';
COMMENT ON COLUMN audit_logs.old_value IS 'Previous state before change (for update/delete actions)';
COMMENT ON COLUMN audit_logs.new_value IS 'New state after change (for create/update actions)';
COMMENT ON COLUMN audit_logs.session_id IS 'Session identifier for tracking user sessions';
COMMENT ON COLUMN audit_logs.device_fingerprint IS 'Device identification hash for security tracking';
COMMENT ON COLUMN audit_logs.prev_hash IS 'Hash of previous log entry for chain integrity verification';
COMMENT ON COLUMN audit_logs.log_hash IS 'SHA-256 hash of current log entry for tamper detection';

COMMIT;
