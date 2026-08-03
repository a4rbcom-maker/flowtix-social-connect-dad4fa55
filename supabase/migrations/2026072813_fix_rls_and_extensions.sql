-- 1. Enable RLS on wa_session_transitions (reference table: from_status / to_status)
ALTER TABLE public.wa_session_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_wa_session_transitions ON public.wa_session_transitions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY write_wa_session_transitions ON public.wa_session_transitions
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- 2. Move extensions from public to extensions schema
ALTER EXTENSION citext SET SCHEMA extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

NOTIFY pgrst, 'reload schema';
