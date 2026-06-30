
-- Explicit deny-all policy on fb_people_db for end users (clarifies intent +
-- silences the "rls_enabled_no_policy" linter). Service role bypasses RLS,
-- so trusted server functions still work normally.
CREATE POLICY "deny all to end users"
  ON public.fb_people_db
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- Move pg_trgm out of public into the dedicated extensions schema.
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO authenticated, service_role, anon;
