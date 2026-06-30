
-- 1) Required extension for fuzzy name search (trigram similarity)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2) Main people database table (Egypt + Iraq Facebook records)
CREATE TABLE public.fb_people_db (
  id            BIGSERIAL PRIMARY KEY,
  country       TEXT NOT NULL CHECK (country IN ('EG','IQ')),
  fbid          TEXT,
  phone_norm    TEXT,
  phone_raw     TEXT,
  first_name    TEXT,
  last_name     TEXT,
  full_name     TEXT GENERATED ALWAYS AS (
    NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), '')
  ) STORED,
  name_norm     TEXT,
  email         TEXT,
  gender        TEXT,
  hometown      TEXT,
  location      TEXT,
  work          TEXT,
  education     TEXT,
  relationship  TEXT,
  religion      TEXT,
  birthday      TEXT,
  birthday_year TEXT,
  locale        TEXT,
  about_me      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Grants: this table is system-internal; only service_role (used by trusted
--    server functions via supabaseAdmin) may read or write. No anon/authenticated
--    grants -> the Data API cannot read it, by design.
GRANT ALL ON public.fb_people_db TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.fb_people_db_id_seq TO service_role;

-- 4) RLS enabled with no policies => all non-superuser non-service_role access denied.
ALTER TABLE public.fb_people_db ENABLE ROW LEVEL SECURITY;

-- 5) Lookup indexes (created on empty table = instant).
--    The heavy GIN trigram index for fuzzy name search is created by the ETL
--    script AFTER the bulk COPY finishes (5-10x faster build that way).
CREATE INDEX fb_people_db_fbid_idx
  ON public.fb_people_db (fbid)
  WHERE fbid IS NOT NULL;

CREATE UNIQUE INDEX fb_people_db_phone_country_uidx
  ON public.fb_people_db (country, phone_norm)
  WHERE phone_norm IS NOT NULL;

CREATE INDEX fb_people_db_email_lower_idx
  ON public.fb_people_db (lower(email))
  WHERE email IS NOT NULL AND email <> 'None' AND email <> '';

CREATE INDEX fb_people_db_name_norm_idx
  ON public.fb_people_db (name_norm)
  WHERE name_norm IS NOT NULL;

-- 6) Lightweight enrichment audit table (per-user counters) so we can show
--    quotas/usage later without scanning the big table.
CREATE TABLE public.fb_enrichment_usage (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day         DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  lookups     INTEGER NOT NULL DEFAULT 0,
  hits        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

GRANT SELECT ON public.fb_enrichment_usage TO authenticated;
GRANT ALL    ON public.fb_enrichment_usage TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.fb_enrichment_usage_id_seq TO service_role;

ALTER TABLE public.fb_enrichment_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own enrichment usage"
  ON public.fb_enrichment_usage
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER trg_fb_enrichment_usage_updated_at
  BEFORE UPDATE ON public.fb_enrichment_usage
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
