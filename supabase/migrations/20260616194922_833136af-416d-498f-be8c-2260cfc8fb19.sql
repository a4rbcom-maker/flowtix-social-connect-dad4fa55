GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_sessions TO authenticated;
GRANT ALL ON public.wa_sessions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_messages TO authenticated;
GRANT ALL ON public.wa_messages TO service_role;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'wa_conversations',
    'wa_keyword_rules',
    'wa_automation_rules',
    'wa_ai_settings',
    'wa_contacts'
  ] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
      EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
    END IF;
  END LOOP;
END $$;