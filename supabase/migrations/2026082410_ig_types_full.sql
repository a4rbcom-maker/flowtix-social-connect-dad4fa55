-- ============================================================
-- IG Extraction v2: full type set (7 extraction types)
-- ============================================================
-- Applied via Supabase Management API statement-by-statement on
-- 2026-08-24 (ALTER TYPE ADD VALUE cannot run inside a transaction).
-- Purely additive: no existing value, row, policy or trigger changes.

ALTER TYPE public.extraction_type ADD VALUE IF NOT EXISTS 'ig_post_commenters' BEFORE 'custom';
ALTER TYPE public.extraction_type ADD VALUE IF NOT EXISTS 'ig_post_engagers' BEFORE 'custom';
ALTER TYPE public.extraction_type ADD VALUE IF NOT EXISTS 'ig_hashtag_posts' BEFORE 'custom';
ALTER TYPE public.extraction_type ADD VALUE IF NOT EXISTS 'ig_profile_info' BEFORE 'custom';
ALTER TYPE public.extraction_type ADD VALUE IF NOT EXISTS 'ig_user_search' BEFORE 'custom';

NOTIFY pgrst, 'reload schema';
