#!/usr/bin/env python3
"""Apply fb_session_leases migration via Supabase Management API."""
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
token_match = re.search(r"sbp_[a-zA-Z0-9]+", (ROOT / "pass.txt").read_text())
TOKEN = token_match.group(0)
REF = "ukjrizflmkutadsrcmut"

STATEMENTS = [
    "ALTER TABLE public.fb_session_leases ENABLE ROW LEVEL SECURITY",
    "DROP POLICY IF EXISTS \"service role full access\" ON public.fb_session_leases",
    "CREATE POLICY \"service role full access\" ON public.fb_session_leases FOR ALL TO service_role USING (true) WITH CHECK (true)",
    """CREATE OR REPLACE FUNCTION public.acquire_fb_session_lease(
  p_session_id uuid,
  p_holder text,
  p_ttl_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.fb_session_leases (session_id, holder, expires_at)
  VALUES (p_session_id, p_holder, now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (session_id) DO UPDATE
    SET holder = p_holder,
        acquired_at = now(),
        expires_at = now() + make_interval(secs => p_ttl_seconds)
    WHERE public.fb_session_leases.holder = p_holder
       OR public.fb_session_leases.expires_at <= now();

  RETURN EXISTS (
    SELECT 1 FROM public.fb_session_leases
    WHERE session_id = p_session_id AND holder = p_holder AND expires_at > now()
  );
END;
$$""",
    """CREATE OR REPLACE FUNCTION public.renew_fb_session_lease(
  p_session_id uuid,
  p_holder text,
  p_ttl_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.fb_session_leases
  SET expires_at = now() + make_interval(secs => p_ttl_seconds)
  WHERE session_id = p_session_id AND holder = p_holder;

  RETURN FOUND;
END;
$$""",
    """CREATE OR REPLACE FUNCTION public.release_fb_session_lease(
  p_session_id uuid,
  p_holder text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.fb_session_leases
  WHERE session_id = p_session_id AND holder = p_holder;
END;
$$""",
    "GRANT EXECUTE ON FUNCTION public.acquire_fb_session_lease(uuid, text, integer) TO service_role",
    "GRANT EXECUTE ON FUNCTION public.renew_fb_session_lease(uuid, text, integer) TO service_role",
    "GRANT EXECUTE ON FUNCTION public.release_fb_session_lease(uuid, text) TO service_role",
    # Verify
    "SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name LIKE '%fb_session_lease%' ORDER BY 1",
]

for stmt in STATEMENTS:
    body = json.dumps({"query": stmt}).encode()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=body,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    label = stmt.strip().splitlines()[0][:70]
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            out = json.loads(resp.read())
            print(f"OK   | {label} | {out if out else ''}")
    except urllib.error.HTTPError as e:
        print(f"FAIL | {label} | {e.read().decode()[:300]}")
        sys.exit(1)
print("DONE")
