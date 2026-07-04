DROP POLICY IF EXISTS "Internal services can manage WhatsApp webhook event dedupe" ON public.wa_webhook_events;
CREATE POLICY "Internal services can manage WhatsApp webhook event dedupe"
ON public.wa_webhook_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);