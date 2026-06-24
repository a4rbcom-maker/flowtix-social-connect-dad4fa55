DELETE FROM ai_model_tiers a USING ai_model_tiers b WHERE a.ctid < b.ctid AND a.tier = b.tier;
UPDATE ai_model_tiers SET model_name = 'gpt-4o-mini', updated_at = now() WHERE tier = 'smart';