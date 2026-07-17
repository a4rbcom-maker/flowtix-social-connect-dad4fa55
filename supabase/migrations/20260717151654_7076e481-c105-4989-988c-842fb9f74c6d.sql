-- Replace the always-on CHECK constraint on fb_campaigns with a smarter
-- validation trigger. The old CHECK re-evaluated on every UPDATE, so any
-- routine status/counter update on a campaign whose bot account had been
-- deleted (account_id set to NULL by the FK ON DELETE SET NULL) failed
-- with 23514 "fb_campaigns_account_source_chk", surfacing as raw toasts.
--
-- New behaviour: validate the (posting_mode, account_id, graph_connection_id)
-- combination on INSERT, and on UPDATE only when one of those columns
-- actually changes. Orphaned rows can still be updated (status, counters,
-- last_run_at, etc.) without violating anything.

ALTER TABLE public.fb_campaigns
  DROP CONSTRAINT IF EXISTS fb_campaigns_account_source_chk;

CREATE OR REPLACE FUNCTION public.fb_campaigns_validate_account_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- On UPDATE, skip validation unless one of the source columns changed.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.posting_mode IS NOT DISTINCT FROM OLD.posting_mode
       AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
       AND NEW.graph_connection_id IS NOT DISTINCT FROM OLD.graph_connection_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.posting_mode = 'bot_worker' AND NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'يجب اختيار حساب بوت صالح لهذه الحملة (posting_mode=bot_worker يتطلب account_id).'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.posting_mode = 'graph_api' AND NEW.graph_connection_id IS NULL THEN
    RAISE EXCEPTION 'يجب اختيار حساب فيسبوك مربوط بالتوكن لهذه الحملة (posting_mode=graph_api يتطلب graph_connection_id).'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.posting_mode NOT IN ('bot_worker', 'graph_api') THEN
    RAISE EXCEPTION 'قيمة posting_mode غير مدعومة: %', NEW.posting_mode
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fb_campaigns_validate_account_source ON public.fb_campaigns;
CREATE TRIGGER fb_campaigns_validate_account_source
BEFORE INSERT OR UPDATE ON public.fb_campaigns
FOR EACH ROW EXECUTE FUNCTION public.fb_campaigns_validate_account_source();