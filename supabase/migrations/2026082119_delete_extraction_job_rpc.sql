-- Permanent extraction-job deletion (job + its results) as one atomic call.
-- extraction_results has no DELETE RLS policy and no FK cascade to
-- extraction_jobs, so deletion must go through this SECURITY DEFINER RPC
-- which verifies ownership itself: users may delete only their own jobs,
-- super admins may delete any.

CREATE OR REPLACE FUNCTION public.delete_extraction_job(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.extraction_jobs WHERE id = p_job_id;

  IF v_owner IS NULL THEN
    RETURN; -- nothing to delete
  END IF;

  IF v_owner <> auth.uid() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'delete_extraction_job: not permitted for this user';
  END IF;

  DELETE FROM public.extraction_results WHERE job_id = p_job_id;
  DELETE FROM public.extraction_jobs WHERE id = p_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_extraction_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_extraction_job(uuid) TO authenticated;
