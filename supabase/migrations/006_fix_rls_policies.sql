-- Fix RLS policies: restrict to user's own rows instead of USING (true)
-- The anon key should only access rows belonging to the requesting user.
-- API routes use service_role (bypasses RLS), but if anon key leaks,
-- USING (true) gives full access to all rows.

-- ============================================================
-- 1. Photos — restrict to user_id match via request header
-- ============================================================
DROP POLICY IF EXISTS "anon_select_own" ON photos;
DROP POLICY IF EXISTS "anon_insert_own" ON photos;
DROP POLICY IF EXISTS "anon_update_own" ON photos;
DROP POLICY IF EXISTS "anon_delete_own" ON photos;

-- Since we use service_role in API routes (bypasses RLS),
-- anon key should have NO access. Deny all for anon.
CREATE POLICY "anon_deny_all" ON photos FOR ALL USING (false);

-- ============================================================
-- 2. Folders — same treatment
-- ============================================================
DROP POLICY IF EXISTS "anon_select_own" ON folders;
DROP POLICY IF EXISTS "anon_insert_own" ON folders;
DROP POLICY IF EXISTS "anon_update_own" ON folders;
DROP POLICY IF EXISTS "anon_delete_own" ON folders;

CREATE POLICY "anon_deny_all" ON folders FOR ALL USING (false);
