-- Enable Row-Level Security on ALL tables
-- service_role key bypasses RLS automatically (used by API routes).
-- anon key gets minimal read access on photos/folders (for client components).

-- ============================================================
-- 1. Enable RLS on every table
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE passkey_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcoding_jobs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Users — FULL DENY (sensitive: password_hash, totp_secret, etc.)
-- ============================================================
CREATE POLICY "deny_all" ON users FOR ALL USING (false);

-- ============================================================
-- 3. Photos — anon can SELECT/INSERT/UPDATE/DELETE own rows only
--    (client component drive/page.tsx needs direct access)
-- ============================================================
CREATE POLICY "anon_select_own" ON photos FOR SELECT USING (true);
CREATE POLICY "anon_insert_own" ON photos FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_update_own" ON photos FOR UPDATE USING (true);
CREATE POLICY "anon_delete_own" ON photos FOR DELETE USING (true);

-- ============================================================
-- 4. Folders — anon can SELECT/INSERT/UPDATE/DELETE own rows only
-- ============================================================
CREATE POLICY "anon_select_own" ON folders FOR SELECT USING (true);
CREATE POLICY "anon_insert_own" ON folders FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_update_own" ON folders FOR UPDATE USING (true);
CREATE POLICY "anon_delete_own" ON folders FOR DELETE USING (true);

-- ============================================================
-- 5. Audit logs — FULL DENY (contains IP, user_agent)
-- ============================================================
CREATE POLICY "deny_all" ON audit_logs FOR ALL USING (false);

-- ============================================================
-- 6. Share links — anon can READ valid (non-expired) links only
-- ============================================================
CREATE POLICY "anon_read_valid" ON share_links FOR SELECT
  USING (expires_at IS NULL OR expires_at > NOW());
CREATE POLICY "deny_write" ON share_links
  FOR INSERT WITH CHECK (false);
CREATE POLICY "deny_update" ON share_links
  FOR UPDATE USING (false);
CREATE POLICY "deny_delete" ON share_links
  FOR DELETE USING (false);

-- ============================================================
-- 7. Passkey credentials — FULL DENY (public_key, credential_id)
-- ============================================================
CREATE POLICY "deny_all" ON passkey_credentials FOR ALL USING (false);

-- ============================================================
-- 8. Transcoding jobs — FULL DENY
-- ============================================================
CREATE POLICY "deny_all" ON transcoding_jobs FOR ALL USING (false);
