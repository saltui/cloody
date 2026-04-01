CREATE TABLE IF NOT EXISTS session_revocations (
    session_id VARCHAR(255) PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    revoked_at TIMESTAMPTZ DEFAULT NOW(),
    reason VARCHAR(100)
);

CREATE INDEX idx_session_revocations_user ON session_revocations(user_id);

-- Auto-cleanup: remove entries older than 30 days (beyond max token lifetime)
-- This can be run periodically via cron

ALTER TABLE session_revocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON session_revocations FOR ALL USING (false);
