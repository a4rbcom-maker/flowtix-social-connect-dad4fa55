## التشخيص

كود الخروج **141 = 128 + SIGPIPE(13)**. مصدره الأسطر التشخيصية:

```bash
echo "$MISSING" | head -n 30
echo "$MISSING" | grep -v '^\./node_modules/' | head -n 30
echo "$EXTRA"   | head -n 30
echo "$EXTRA"   | grep -v '^\./node_modules/' | head -n 30
```

تحت `set -euo pipefail`: لما `head` يقفل stdin بعد 30 سطر، الأمر اللي قبله (`echo`/`grep`) يأخذ SIGPIPE، و `pipefail` يحوّل الـ pipeline لفشل = **141**، فيخرج السكربت قبل ما يكمّل ويطبع `ERROR:` الحقيقي ويستدعي `integrity_rollback`.

اللقطة في الصورة بتعرض ملفات `dashboard.*` — يعني فعلاً فيه drift بين CI و VPS (ملفات زيادة على السيرفر أو ناقصة)، والـ guard اشتغل صح لكن الطباعة قتلته.

## الإصلاح (ملف واحد: `.github/workflows/deploy.yml`)

### 1) استبدال `| head -n 30` بأدوات لا تقفل stdin مبكرًا

في الأسطر 463، 470، 475، 482 نستخدم `awk 'NR<=30'` (أو `sed -n '1,30p'` مع `cat` drain). `awk` يقرأ كل الـ input لحد EOF فلا SIGPIPE.

```bash
printf '%s\n' "$MISSING" | awk 'NR<=30'
printf '%s\n' "$MISSING" | grep -v '^\./node_modules/' | awk 'NR<=30'
printf '%s\n' "$EXTRA"   | awk 'NR<=30'
printf '%s\n' "$EXTRA"   | grep -v '^\./node_modules/' | awk 'NR<=30'
```

(ونستخدم `printf` بدل `echo` للأمان مع المحتوى).

### 2) عزل أي pipeline تشخيصية تحت pipefail

نلف بلوك الطباعة (السطور 461–485) بـ:
```bash
set +o pipefail
... diagnostics ...
set -o pipefail
```
كحزام أمان إضافي، عشان أي `head/grep/awk` مستقبلي ما يكسرش الـ step.

### 3) تحسين عدّ `grep -c` (السطور 464–465، 476–477)

`grep -c` يرجع 1 لو ما لقاش match — مع `set -e` بنحتاج `|| true` (موجود) لكن النتيجة لما `MISSING` فاضي بترجع سلسلة فاضية. نضمن قيمة عددية دائمًا:
```bash
MISSING_NM=$(printf '%s\n' "$MISSING" | grep -c '^\./node_modules/' 2>/dev/null || echo 0)
MISSING_NM=${MISSING_NM:-0}
```

### 4) السبب الفعلي تحت السطح

بعد الإصلاح، السكربت هيكمل ويطبع الـ ERROR المناسب (`file-list-drift` غالبًا) ويستدعي `integrity_rollback "file-list-drift"`، وبعدين تستلم الخطوة الخارجية الإشارة وتسجل `FAILURE_REASON=integrity-restored-last-good` (لو في LAST_GOOD) أو `integrity-no-snapshot`.

هتشوف في الـ logs السبب الحقيقي (مثلاً: ملفات `dashboard.*` موجودة على VPS من deploy قديم و rsync مش قادر يحذفها بسبب صلاحيات، أو ملفات جديدة من CI ما وصلتش).

## الخطوات

1. تعديل `.github/workflows/deploy.yml` فقط في خطوة `Install dependencies and restart SSR app` (الأسطر 461–485):
   - استبدال `head -n 30` بـ `awk 'NR<=30'`
   - استبدال `echo "$VAR"` بـ `printf '%s\n' "$VAR"`
   - تطبيق `set +o pipefail` حول بلوك الطباعة
   - تأمين `MISSING_NM/MISSING_APP/EXTRA_NM/EXTRA_APP` بقيمة افتراضية 0

2. إعادة تشغيل الـ workflow — لو لسه فيه drift، هيظهر السبب بوضوح ويتم rollback تلقائي.

## ملاحظة للمستخدم

الفشل الأصلي مش bug في الـ deployment نفسه — هو الـ integrity guard اللي طلبته اشتغل صح ورصد اختلاف حقيقي بين ملفات CI وVPS، بس الطباعة التشخيصية كسرت السكربت قبل ما يوضّح السبب. بعد الإصلاح هتشوف بالضبط أنهي ملفات ناقصة/زيادة وهيحصل rollback تلقائي لآخر نسخة LAST_GOOD.
