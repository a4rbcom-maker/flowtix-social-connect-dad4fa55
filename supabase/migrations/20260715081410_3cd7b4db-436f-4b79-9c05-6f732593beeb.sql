
-- 1. Add columns to wa_sessions for multi-account support
ALTER TABLE public.wa_sessions
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS label text;

-- 2. Drop old unique constraint on user_id (blocks multi-session)
ALTER TABLE public.wa_sessions DROP CONSTRAINT IF EXISTS wa_sessions_user_id_key;

-- 3. Backfill existing rows as primary
UPDATE public.wa_sessions SET is_primary = true WHERE is_primary = false;

-- 4. Partial unique index: only one primary per user
CREATE UNIQUE INDEX IF NOT EXISTS wa_sessions_one_primary_per_user
  ON public.wa_sessions(user_id) WHERE is_primary = true;

-- 5. Backfill plan limits with wa_accounts_max defaults
UPDATE public.plans SET limits = COALESCE(limits, '{}'::jsonb) || jsonb_build_object(
  'wa_accounts_max', CASE slug
    WHEN 'free' THEN 1
    WHEN 'pro' THEN 3
    WHEN 'business' THEN 10
    ELSE 1
  END
) WHERE (limits->>'wa_accounts_max') IS NULL;

-- 6. Function to get max WA accounts for a user (based on their plan)
CREATE OR REPLACE FUNCTION public.wa_user_session_limit(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (p.limits->>'wa_accounts_max')::int
       FROM public.plans p
       JOIN public.profiles pr ON pr.plan = p.slug
      WHERE pr.id = _user_id
      LIMIT 1),
    1
  )
$$;

-- 7. Trigger to enforce the limit on insert
CREATE OR REPLACE FUNCTION public.wa_enforce_session_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count int;
  max_allowed int;
BEGIN
  SELECT count(*) INTO current_count FROM public.wa_sessions WHERE user_id = NEW.user_id;
  max_allowed := public.wa_user_session_limit(NEW.user_id);
  IF current_count >= max_allowed THEN
    RAISE EXCEPTION 'WA_SESSION_LIMIT_REACHED: max % accounts allowed for your plan', max_allowed
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wa_sessions_enforce_limit ON public.wa_sessions;
CREATE TRIGGER wa_sessions_enforce_limit
  BEFORE INSERT ON public.wa_sessions
  FOR EACH ROW EXECUTE FUNCTION public.wa_enforce_session_limit();

-- 8. Auto-promote another session to primary when the current primary is deleted
CREATE OR REPLACE FUNCTION public.wa_promote_next_primary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_primary THEN
    UPDATE public.wa_sessions
       SET is_primary = true
     WHERE id = (
       SELECT id FROM public.wa_sessions
        WHERE user_id = OLD.user_id AND id <> OLD.id
        ORDER BY (status = 'connected') DESC, updated_at DESC
        LIMIT 1
     );
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS wa_sessions_promote_next ON public.wa_sessions;
CREATE TRIGGER wa_sessions_promote_next
  AFTER DELETE ON public.wa_sessions
  FOR EACH ROW EXECUTE FUNCTION public.wa_promote_next_primary();
