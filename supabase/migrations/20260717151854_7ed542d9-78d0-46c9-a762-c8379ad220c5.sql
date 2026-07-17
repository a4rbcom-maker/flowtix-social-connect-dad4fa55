CREATE OR REPLACE FUNCTION public.fb_campaigns_validate_account_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- On UPDATE, allow the FK ON DELETE SET NULL cascade to null out
  -- account_id / graph_connection_id (the parent account was deleted).
  -- The row simply becomes "orphaned" and can still receive status/counter
  -- updates. Only reject UPDATEs that set a NEW non-null-but-wrong source.
  IF TG_OP = 'UPDATE' THEN
    -- Nothing source-related changed -> skip.
    IF NEW.posting_mode IS NOT DISTINCT FROM OLD.posting_mode
       AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
       AND NEW.graph_connection_id IS NOT DISTINCT FROM OLD.graph_connection_id THEN
      RETURN NEW;
    END IF;

    -- A source column is being cleared (cascade or manual detach) -> allow.
    IF NEW.posting_mode IS NOT DISTINCT FROM OLD.posting_mode
       AND (
         (NEW.account_id IS NULL AND OLD.account_id IS NOT NULL)
         OR (NEW.graph_connection_id IS NULL AND OLD.graph_connection_id IS NOT NULL)
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Strict validation for INSERT and for UPDATEs that set a new source.
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