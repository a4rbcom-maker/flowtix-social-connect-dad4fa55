
ALTER TABLE public.wa_messages ADD COLUMN IF NOT EXISTS wa_timestamp timestamptz;

-- Backfill from raw payload (messageTimestamp / t / timestamp) when present, fall back to created_at
UPDATE public.wa_messages
SET wa_timestamp = COALESCE(
  CASE
    WHEN (raw->>'messageTimestamp') ~ '^[0-9]+$'
      THEN to_timestamp((raw->>'messageTimestamp')::bigint)
    WHEN (raw->>'t') ~ '^[0-9]+$'
      THEN to_timestamp((raw->>'t')::bigint)
    WHEN (raw->>'timestamp') ~ '^[0-9]+$'
      THEN to_timestamp((raw->>'timestamp')::bigint)
    ELSE NULL
  END,
  created_at
)
WHERE wa_timestamp IS NULL;

CREATE INDEX IF NOT EXISTS wa_messages_user_jid_watime_idx
  ON public.wa_messages (user_id, remote_jid, wa_timestamp);

-- Recompute last_message_at on conversations from the real timestamps
UPDATE public.wa_conversations c
SET last_message_at = sub.max_ts
FROM (
  SELECT user_id, remote_jid, MAX(COALESCE(wa_timestamp, created_at)) AS max_ts
  FROM public.wa_messages
  GROUP BY user_id, remote_jid
) sub
WHERE c.user_id = sub.user_id
  AND c.remote_jid = sub.remote_jid;
