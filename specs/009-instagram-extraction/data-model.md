# Data Model: استخراج إنستجرام

**المرجع**: [spec.md](./spec.md) + [research.md](./research.md) (R1, R4, R5)

## الجداول الجديدة (migration: `supabase/migrations/2026081810_ig_extraction.sql`)

### ig_sessions

| العمود | النوع | القيود | ملاحظات |
| --- | --- | --- | --- |
| id | uuid PK | DEFAULT gen_random_uuid() | |
| user_id | uuid | NOT NULL, REFERENCES auth.users | عزل المستخدم |
| name | text | NOT NULL | اسم يعرضه المستخدم |
| status | text | NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','disconnected','needs_login')) | |
| ig_username | text | | يُقرأ عند الفحص |
| ig_user_id | text | | ds_user_id من الكوكيز |
| avatar_url | text | | |
| last_checked_at | timestamptz | | آخر session-check ناجح |
| created_at / updated_at | timestamptz | DEFAULT now() | |
| deleted_at | timestamptz | NULL | soft delete (قاعدة AGENTS.md) |

**فهارس**: `(user_id, deleted_at)`، `(ig_username)`

**RLS**: مفعّل — سياسات select/insert/update/delete بشرط `auth.uid() = user_id` (مرآة `fb_sessions` كما في `2026072817_fix_fb_sessions_rls_user_id.sql`)

### ig_browser_profiles

| العمود | النوع | القيود | ملاحظات |
| --- | --- | --- | --- |
| session_id | uuid PK | REFERENCES ig_sessions(id) ON DELETE CASCADE | |
| cookies_enc | text | NOT NULL | JSON كوكيز بصيغة EditThisCookie (نفس parseCookiesToPlaywright) |
| user_agent | text | | |
| updated_at | timestamptz | DEFAULT now() | |

**RLS**: مفعّل — نفس نمط `fb_browser_profiles` (join عبر ig_sessions.user_id = auth.uid())

## تعديل جدول قائم

### extraction_results

```sql
ALTER TABLE extraction_results
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'facebook';
CREATE INDEX IF NOT EXISTS idx_extraction_results_platform
  ON extraction_results (platform);
```

- `platform ∈ ('facebook','instagram')` — DEFAULT 'facebook' يحفظ التوافق الخلفي لكل الكود القائم
- نتائج IG: `fb_id = username` (مفتاح dedupe)، `fb_type` يحمل نوع `ig_*`، و`data` JSONB يفصّل الحقول أدناه

## قيم الأنواع الجديدة (ExtractionType في `types.ts`)

```
ig_followers | ig_following | ig_post_commenters | ig_hashtag_posts | ig_profile_info
```

`extraction_jobs` يُعاد استخدامه كما هو — `type` يحمل القيم أعلاه و`config.source` يحمل username/الرابط/الهاشتاج.

## شكل `data` JSONB لنتائج IG (موحّد عبر الأنواع)

| الحقل | الأنواع | ملاحظات |
| --- | --- | --- |
| username | الكل | المعرف الأساسي |
| full_name | الكل | قد يفرغ |
| profile_url | الكل | `https://instagram.com/{username}` |
| avatar_url | الكل | |
| comment_text / comment_id | ig_post_commenters | لكل معلّق (dedupe يجمع التعليقات) |
| comments_count | ig_post_commenters | عدد تعليقات هذا المعلّق على المنشور |
| post_url / post_shortcode | ig_hashtag_posts (المنشور) | يُخزّن في سجل المنشور لا سجل صاحبه |
| bio / followers_count / posts_count / external_url / is_verified | ig_profile_info (+ hashtag كمرجع) | |
| bio_email / bio_phone | ig_profile_info | مستخلصان بـ regex (R3) |

## شكل `metadata` للإثراء (بعد مرحلة الإثراء)

```json
{
  "platform": "instagram",
  "enrichment": {
    "phone": "01xxxxxxxxx", "first_name": "...", "last_name": "...",
    "email": "...", "country": "...", "...": "بقية أعمدة EnrichmentRow المتاحة"
  },
  "match_confidence": "confirmed | probable",
  "match_method": "bio_phone | bio_email | full_name"
}
```

- `match_confidence`: "confirmed" لمطابقة bio (هاتف/بريد)، "probable" لمطابقة الاسم الكامل exact فقط (قرار Clarifications C / R5)
- تُعرض الشارة في صفحة الجهات وتُصدَّر كعمود

## دورة حياة المهمة (JobStatus القائم دون تغيير)

`queued → running → completed | failed | canceled | paused`

- completed: المصدر نُفد أو بلوغ ceiling (مع نسبة التغطية في progress)
- paused: كل جلسات IG حُظرت/انتهت — قابلة للاستئناف بجلسة أخرى (R7)
- canceled: إيقاف المستخدم — بيانات جزئية محفوظة (نفس قواعد fb)

## قواعد تحقق

- username: `^[A-Za-z0-9._]{1,30}$` — يُرفض المصدر المخالف برسالة INVALID_INPUT
- رابط منشور: يقبل `instagram.com/p/{code}` و`/reel/{code}` و`/tv/{code}` فقط
- هاشتاج: `^[\p{L}\p{N}_]+$` (يدعم العربية) بعد تجريد `#`
- الكوكيز: رفض الاستيراد دون `sessionid` + `ds_user_id` + `csrftoken` برسالة واضحة (R9)
