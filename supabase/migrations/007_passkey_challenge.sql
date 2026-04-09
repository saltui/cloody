-- Add passkey_challenge column to users table (used during registration/authentication)
ALTER TABLE users ADD COLUMN IF NOT EXISTS passkey_challenge VARCHAR(255);

-- Create passkey_challenges table for discoverable credential flows
CREATE TABLE IF NOT EXISTS passkey_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge VARCHAR(255) NOT NULL UNIQUE,
    binding_hash VARCHAR(64),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE passkey_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON passkey_challenges FOR ALL USING (false);

-- Auto-cleanup expired challenges
CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expires ON passkey_challenges(expires_at);
