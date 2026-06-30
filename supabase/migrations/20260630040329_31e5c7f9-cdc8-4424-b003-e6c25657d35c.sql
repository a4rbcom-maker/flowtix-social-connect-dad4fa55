
CREATE TABLE public.customer_database (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text,
  phone_norm text,
  email text,
  city text,
  governorate text,
  address text,
  fb_id text,
  fb_profile_url text,
  name_norm text,
  notes text,
  tags text[],
  extra jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_database TO authenticated;
GRANT ALL ON public.customer_database TO service_role;

ALTER TABLE public.customer_database ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own customers select" ON public.customer_database FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own customers insert" ON public.customer_database FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own customers update" ON public.customer_database FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own customers delete" ON public.customer_database FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX customer_db_user_idx ON public.customer_database(user_id);
CREATE INDEX customer_db_fb_id_idx ON public.customer_database(user_id, fb_id) WHERE fb_id IS NOT NULL;
CREATE INDEX customer_db_phone_idx ON public.customer_database(user_id, phone_norm) WHERE phone_norm IS NOT NULL;
CREATE INDEX customer_db_name_idx ON public.customer_database(user_id, name_norm) WHERE name_norm IS NOT NULL;
CREATE INDEX customer_db_email_idx ON public.customer_database(user_id, lower(email)) WHERE email IS NOT NULL;

CREATE TRIGGER set_customer_db_updated_at
  BEFORE UPDATE ON public.customer_database
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
