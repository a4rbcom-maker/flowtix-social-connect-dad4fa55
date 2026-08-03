-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  Fix: ai_provider_accounts                                       ║
-- ║  1) credits: integer → numeric (Kie.ai returns decimals)         ║
-- ║  2) UNIQUE on api_key_enc (prevent duplicate API keys)           ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- 1️⃣ تغيير نوع credits من integer إلى numeric لدعم القيم العشرية
--    (Kie.ai يُرجع قيم مثل -0.36)
ALTER TABLE ai_provider_accounts
    ALTER COLUMN credits TYPE numeric(14,4)
    USING credits::numeric(14,4);

ALTER TABLE ai_provider_accounts
    ALTER COLUMN credits SET DEFAULT 0;

-- 2️⃣ قيد التفرد على api_key_enc لمنع تكرار نفس المفتاح
--    (نستخدم partial index لتجنب التعارض مع NULL values إن وجدت)
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_accounts_api_key_uniq
    ON ai_provider_accounts (api_key_enc)
    WHERE api_key_enc IS NOT NULL;

-- 3️⃣ فهرس على workspace_id لتسريع الاستعلامات
CREATE INDEX IF NOT EXISTS ai_provider_accounts_ws_idx
    ON ai_provider_accounts (workspace_id, priority);
