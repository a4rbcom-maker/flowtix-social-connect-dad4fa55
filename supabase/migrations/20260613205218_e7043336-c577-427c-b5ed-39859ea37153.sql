-- Restrict ai_model_tiers SELECT: non-admins only see enabled rows
DROP POLICY IF EXISTS "Anyone authenticated reads enabled tiers" ON public.ai_model_tiers;
CREATE POLICY "Authenticated read enabled tiers or admin" ON public.ai_model_tiers
  FOR SELECT TO authenticated
  USING (enabled = true OR public.has_role(auth.uid(), 'admin'::app_role));

-- Restrict platform_settings SELECT: admin only (only admin functions read this table)
DROP POLICY IF EXISTS "Anyone authenticated reads settings" ON public.platform_settings;
CREATE POLICY "Admins read settings" ON public.platform_settings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
