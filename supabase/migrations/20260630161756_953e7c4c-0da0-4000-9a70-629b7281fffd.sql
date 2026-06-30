CREATE OR REPLACE FUNCTION public.fb_people_post_index()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  counts jsonb;
BEGIN
  PERFORM set_config('maintenance_work_mem', '512MB', true);
  CREATE INDEX IF NOT EXISTS fb_people_db_name_trgm_idx
    ON public.fb_people_db
    USING GIN (name_norm extensions.gin_trgm_ops)
    WHERE name_norm IS NOT NULL;
  ANALYZE public.fb_people_db;
  SELECT jsonb_object_agg(country, n) INTO counts
  FROM (SELECT country, count(*)::bigint AS n FROM public.fb_people_db GROUP BY country) t;
  RETURN jsonb_build_object('ok', true, 'counts', COALESCE(counts, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.fb_people_post_index() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fb_people_post_index() TO service_role;