
-- Fuzzy name search RPC: returns the top-1 person whose name_norm is most
-- similar to the input (using pg_trgm trigram similarity). Service role only.
CREATE OR REPLACE FUNCTION public.fb_people_fuzzy_name(q text, min_sim real DEFAULT 0.6)
RETURNS TABLE (
  fbid text, phone_raw text, email text,
  first_name text, last_name text, full_name text,
  gender text, hometown text, location text, work text,
  education text, relationship text, religion text,
  birthday text, locale text, country text,
  name_norm text, sim real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    p.fbid, p.phone_raw, p.email,
    p.first_name, p.last_name, p.full_name,
    p.gender, p.hometown, p.location, p.work,
    p.education, p.relationship, p.religion,
    p.birthday, p.locale, p.country,
    p.name_norm,
    extensions.similarity(p.name_norm, q) AS sim
  FROM public.fb_people_db p
  WHERE p.name_norm IS NOT NULL
    AND p.name_norm % q                            -- uses GIN trgm index
    AND extensions.similarity(p.name_norm, q) >= min_sim
  ORDER BY extensions.similarity(p.name_norm, q) DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fb_people_fuzzy_name(text, real) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.fb_people_fuzzy_name(text, real) TO service_role;

-- Audit RPC: upserts a day-bucket counter for a given user.
CREATE OR REPLACE FUNCTION public.fb_enrichment_record(_user_id uuid, _lookups int, _hits int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.fb_enrichment_usage (user_id, day, lookups, hits)
  VALUES (_user_id, (now() AT TIME ZONE 'utc')::date, GREATEST(_lookups,0), GREATEST(_hits,0))
  ON CONFLICT (user_id, day) DO UPDATE
    SET lookups = public.fb_enrichment_usage.lookups + EXCLUDED.lookups,
        hits    = public.fb_enrichment_usage.hits    + EXCLUDED.hits,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.fb_enrichment_record(uuid, int, int) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.fb_enrichment_record(uuid, int, int) TO service_role;
