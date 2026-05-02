CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  connection_type TEXT NOT NULL DEFAULT 'meta_api',
  meta_phone_number_id TEXT,
  meta_access_token TEXT,
  meta_business_account_id TEXT,
  meta_verify_token TEXT,
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  ai_model TEXT DEFAULT 'google/gemini-2.5-flash',
  ai_system_prompt TEXT,
  ai_welcome_message TEXT,
  ai_business_hours_only BOOLEAN DEFAULT false,
  is_connected BOOLEAN NOT NULL DEFAULT false,
  last_connected_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_connection_type_check CHECK (connection_type IN ('meta_api','qr_code'))
);

ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own wa settings" ON public.whatsapp_settings;
CREATE POLICY "Users view own wa settings"
ON public.whatsapp_settings FOR SELECT
TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own wa settings" ON public.whatsapp_settings;
CREATE POLICY "Users insert own wa settings"
ON public.whatsapp_settings FOR INSERT
TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own wa settings" ON public.whatsapp_settings;
CREATE POLICY "Users update own wa settings"
ON public.whatsapp_settings FOR UPDATE
TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own wa settings" ON public.whatsapp_settings;
CREATE POLICY "Users delete own wa settings"
ON public.whatsapp_settings FOR DELETE
TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS update_whatsapp_settings_updated_at ON public.whatsapp_settings;
CREATE TRIGGER update_whatsapp_settings_updated_at
BEFORE UPDATE ON public.whatsapp_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Ensure trigger exists for facebook_connections too
DROP TRIGGER IF EXISTS update_facebook_connections_updated_at ON public.facebook_connections;
CREATE TRIGGER update_facebook_connections_updated_at
BEFORE UPDATE ON public.facebook_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();