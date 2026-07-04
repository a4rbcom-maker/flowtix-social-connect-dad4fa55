UPDATE public.wa_messages
SET status = 'failed',
    raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object(
      'delivery', 'failed_after_timeout',
      'deliveryError', 'لم يتم تأكيد وصول الرسالة للواتساب خلال المهلة المحددة',
      'failedAt', now()
    )
WHERE direction = 'out'
  AND status = 'pending'
  AND created_at < now() - interval '10 minutes';