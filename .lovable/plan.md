## الحل الحذِر — تشخيص أولاً، تعديل بعدين

من الصورة عندنا الأعراض النهائية فقط:
```
SKIP good-*  (no smoke-verified snapshots exist yet)
=== End snapshot inventory ===
Error: No trusted SSR snapshot available
INTEGRITY_ROLLBACK_RESULT=no_valid_snapshot
Error: Bundle integrity check failed AND no valid snapshot was available
```

لكن **ناقص المعلومة الأهم**: ليش `integrity_rollback` انطلق أصلاً؟  
الكود في `deploy.yml` ينادي `integrity_rollback` من **ثلاث** نقاط مختلفة، وكل واحدة لها سبب جذري مختلف وحل مختلف:

| السطر | السبب | المعنى |
|---|---|---|
| 632 | `manifest-inconsistent` | `manifest.json` نفسه فيه أرقام متناقضة (CI bundling مكسور) |
| 639 | `checksum-failed` | `sha256sum -c` فشل (ملف اتعدّل/اتقطع أثناء rsync) |
| 714 | `file-list-drift` | عدد ملفات VPS ≠ manifest (rsync `--delete` ما قدر يمسح، أو نقل ناقص) |

بدون معرفة أيهم انطلق، أي تعديل على منطق rollback راح يكون تخمين وممكن يخفي bug حقيقي في rsync أو في الـ build.

### المشكلة الثانية المنفصلة
حتى لو عرفنا السبب الجذري وأصلحناه، حالة **"أول deploy على شكل البندل الجديد"** صحيحة فعلاً:
- `LAST_GOOD` ما اتسجّل بعد (يحتاج deploy ناجح كامل أولاً)
- `PREV_SNAPSHOT` — السطر 358 يكتبه قبل rsync، فالمفروض موجود. الصورة تقول `SKIP good-*` بس ما توضح حالة `PREV_SNAPSHOT` (هل قال REJECT ولا ما طُبع أصلاً؟)

### الخطوات المقترحة (بترتيب صارم)

**1. لا نعدّل أي ملف الآن.** نطلب من المستخدم يفتح الـ job في GitHub، يوسّع نفس الـ step (`Install dependencies and restart SSR app`)، ويسحب لفوق حتى يلقى أول `ERROR:` قبل سطر 630. هذا السطر يقول بالضبط:
   - `manifest-inconsistent`؟ → نشوف `MANIFEST_TOTAL` vs `SUMS_FILES`
   - `checksum-failed`؟ → نشوف أي ملف فشل في sha256
   - `file-list-drift`؟ → نشوف قوائم Missing/Extra المطبوعة

   ونحتاج كذلك يصوّر/ينسخ كتلة `=== Snapshot inventory ===` كاملة (الأسطر اللي تذكر `LAST_GOOD` و `PREV_SNAPSHOT` بـ ACCEPT/REJECT/SKIP).

**2. بعد ما نشوف السبب:** نختار واحد من ثلاث مسارات بدقة:

   - لو `file-list-drift` بسبب ملفات قديمة على VPS: نضيف خطوة تنظيف موجّهة (مش تخفيف الفحص).
   - لو `checksum-failed`: نفحص rsync flags (compress، partial) ونرفع `--checksum`.
   - لو `manifest-inconsistent`: المشكلة في `generate-manifest` على CI نفسه، نصلحها هناك.
   - لو الكل سليم وفقط الـ rollback ما لقى snapshot لأن أول deploy: نضيف **bootstrap mode** يطبع notice واضح بدل error، **بدون** ما يخفف شروط `is_valid_ssr_snapshot`.

**3. ما نعمله الآن (بناءً على ملف `.lovable/plan.md` الموجود):** الخطة المكتوبة هناك تقترح تخفيف قبول `PREV_SNAPSHOT` — لكن هذا يحلّ عَرَض واحد فقط (الـ rollback) ويترك سبب الفشل الأصلي مخفيًا. أنصح **بتأجيلها** حتى نعرف السبب الجذري.

### اللي محتاجه منك الآن
ثلاث معلومات من نفس الـ job:

1. لقطة شاشة للأسطر **قبل** 627 — تحديداً أول سطر يبدأ بـ `ERROR:` في step `Install dependencies and restart SSR app`.
2. لقطة لكتلة `=== Snapshot inventory ===` بالكامل (تشمل تقييمات `LAST_GOOD` و `PREV_SNAPSHOT`).
3. هل هذا أول deploy بعد إضافة `scripts/tanstack-node-server.mjs` للريبو؟ ولا في deploys ناجحة سابقة بالشكل الجديد؟

بعد ما توصلني هذي الثلاث، أرجع بخطة `plan--create` ثانية فيها التعديل الدقيق على الملف الصحيح (deploy.yml أو CI bundling أو rsync flags) بدون تخمين.
