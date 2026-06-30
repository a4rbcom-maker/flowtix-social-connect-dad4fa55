---
name: FB People Enrichment DB
description: 57M Egypt+Iraq Facebook records in fb_people_db, enriched via enrichFbPeople server-fn with FBID→phone→email→name cascade + pg_trgm fuzzy
type: feature
---
# قاعدة بيانات إثراء فيسبوك (مصر + العراق)

## الجدول
`public.fb_people_db` (~57M صف، 14GB) — مفهرس على fbid, (country,phone_norm), lower(email), name_norm. RLS مغلق على المستخدمين النهائيين؛ القراءة عبر `service_role` فقط.

## الاستيراد
- سكربت `scripts/etl-fb-people-db.mjs` يستورد من ملفات SQLite الأصلية (egypt.db / Iraq.db) إلى Postgres عبر COPY في staging table مع dedupe على (country, phone_norm).
- يتعامل مع فساد صفحات SQLite بـ binary halving لتخطّي الصفوف الفاسدة دون توقف.
- بعد الاستيراد: `node scripts/etl-fb-people-db.mjs --post-index` لبناء GIN trgm index.
- الـ runbook الكامل في `scripts/README-fb-people-db.md`.

## API الإثراء
- Server-fn: `enrichFbPeople({ leads: [{fbid?, phone?, email?, name?}] })` في `src/lib/fb-people-enrich.functions.ts`.
- Cascade: FBID → phone_norm (آخر 10 أرقام) → email lower → name_norm exact → pg_trgm fuzzy ≥0.6.
- يستخدم `supabaseAdmin` داخل الـ handler (lazy import للحفاظ على client.server خارج bundle العميل).
- التطبيع: نفس الـ logic بين السكربت والـ server-fn (Arabic normalization + phone last-10).
- RPC: `fb_people_fuzzy_name(q, min_sim)` و `fb_enrichment_record(user, lookups, hits)` — service_role only.

## التكامل بالواجهة
- صفحة `/dashboard/enrich` تستدعي الـ server-fn تلقائياً بعد الـ regex pass؛ بيانات قاعدة فيسبوك تظهر بـ badge "FB DB" بنفسجي وتطغى على الـ regex حين توجد.
- الأولوية في التعارض: قاعدة عملاء المستخدم > قاعدة FB العامة > regex.

## الحدود اليومية
جدول `fb_enrichment_usage` يتتبع lookups/hits لكل مستخدم/يوم (لا حدود مفروضة بعد — قراءة فقط للمستخدم نفسه).
