
CREATE POLICY "Anyone authenticated can read ai model tiers"
  ON public.ai_model_tiers FOR SELECT
  TO authenticated
  USING (true);
