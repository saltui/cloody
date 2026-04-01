-- Rate limits table (persistent store for serverless rate limiting)
CREATE TABLE IF NOT EXISTS rate_limits (
    key VARCHAR(255) PRIMARY KEY,
    count INTEGER DEFAULT 1,
    first_attempt_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON rate_limits FOR ALL USING (false);

-- Add binding_hash to passkey_challenges for IP+UA challenge binding
ALTER TABLE passkey_challenges ADD COLUMN IF NOT EXISTS binding_hash VARCHAR(64);
