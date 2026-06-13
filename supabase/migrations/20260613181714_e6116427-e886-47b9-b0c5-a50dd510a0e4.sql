
-- 1) Extend platform_announcements with new fields
ALTER TABLE public.platform_announcements
  ADD COLUMN IF NOT EXISTS notif_type text NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS require_ack boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_as_popup boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- Validation trigger (mutable rules instead of CHECK)
CREATE OR REPLACE FUNCTION public.validate_announcement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.notif_type NOT IN ('info','alert','update','maintenance','warning','offer','success') THEN
    RAISE EXCEPTION 'invalid notif_type: %', NEW.notif_type;
  END IF;
  IF NEW.priority NOT IN ('low','normal','high','urgent') THEN
    RAISE EXCEPTION 'invalid priority: %', NEW.priority;
  END IF;
  IF NEW.target_kind NOT IN ('all','plan','users','single_user','active_users','suspended_users') THEN
    RAISE EXCEPTION 'invalid target_kind: %', NEW.target_kind;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_announcement ON public.platform_announcements;
CREATE TRIGGER trg_validate_announcement
  BEFORE INSERT OR UPDATE ON public.platform_announcements
  FOR EACH ROW EXECUTE FUNCTION public.validate_announcement();

-- 2) Add user status on profiles (for active_users / suspended_users targeting)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

CREATE OR REPLACE FUNCTION public.validate_profile_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('active','suspended','warned') THEN
    RAISE EXCEPTION 'invalid profile status: %', NEW.status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_profile_status ON public.profiles;
CREATE TRIGGER trg_validate_profile_status
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_profile_status();

-- 3) Per-user read tracking table
CREATE TABLE IF NOT EXISTS public.notification_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.platform_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz,
  read_at timestamptz,
  ack_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notif_reads_user ON public.notification_reads (user_id);
CREATE INDEX IF NOT EXISTS idx_notif_reads_ann ON public.notification_reads (announcement_id);

GRANT SELECT, INSERT, UPDATE ON public.notification_reads TO authenticated;
GRANT ALL ON public.notification_reads TO service_role;

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own read-status"
  ON public.notification_reads FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "users insert own read-status"
  ON public.notification_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users update own read-status"
  ON public.notification_reads FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_notif_reads_updated_at
  BEFORE UPDATE ON public.notification_reads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Allow authenticated users to SELECT their targeted announcements
-- (we re-create the policy idempotently)
DROP POLICY IF EXISTS "users read targeted announcements" ON public.platform_announcements;
CREATE POLICY "users read targeted announcements"
  ON public.platform_announcements FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      (starts_at <= now())
      AND (ends_at IS NULL OR ends_at > now())
      AND (
        target_kind = 'all'
        OR (target_kind = 'plan' AND target_plan = (SELECT plan FROM public.profiles WHERE id = auth.uid()))
        OR (target_kind IN ('users','single_user') AND auth.uid() = ANY(COALESCE(target_user_ids, ARRAY[]::uuid[])))
        OR (target_kind = 'active_users' AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active'))
        OR (target_kind = 'suspended_users' AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status IN ('suspended','warned')))
      )
    )
  );

GRANT SELECT ON public.platform_announcements TO authenticated;
