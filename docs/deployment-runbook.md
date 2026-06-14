# Deployment Runbook — flowtixtools.com (VPS)

دليل تشغيل قصير لتشخيص فشل النشر بسرعة بدون تخمين. مصدر الحقيقة هو
`deploy-version.json` على القرص في `$DEPLOY_PATH` على الـVPS.

آخر تعديل مزامنة: 2026-06-14 — touch آمن لتشغيل GitHub sync/deploy بدون تغيير سلوك التطبيق.

---

## مصادر الحقيقة

| المصدر | المسار | ماذا يقول |
|---|---|---|
| القرص على VPS | `$DEPLOY_PATH/deploy-version.json` | الملفات اللي وصلت فعلاً بعد rsync |
| التطبيق محليًا على VPS | `http://127.0.0.1:3100/deploy-version.json` | اللي PM2 يخدمه الآن (Node runner يقرأ الملف من القرص) |
| الدومين العام | `https://www.flowtixtools.com/deploy-version.json` | اللي المستخدم النهائي يشوفه (يمر عبر Nginx + Cloudflare) |
| الصحة | `https://www.flowtixtools.com/api/public/health` | حي + build.sha من الملف |

القاعدة: لو الثلاثة متفقين على نفس `short_sha` → النشر سليم. لو اختلفوا
حدد الطبقة المختلفة وتعامل معها.

الإعدادات الثابتة لهذا السيرفر: `DEPLOY_PATH=/www/wwwroot/flowtixtools.com`
و`APP_PORT=3100`. أي deploy على مسار أو بورت مختلف لن يغيّر الموقع العام.

---

## ماتركس التشخيص

| القرص | محلي 127.0.0.1 | الدومين العام | السبب الأرجح | الإجراء |
|---|---|---|---|---|
| جديد | جديد | جديد | كل شيء تمام | لا شيء |
| جديد | جديد | قديم/502 | Nginx upstream خطأ أو Cloudflare cache | افحص Nginx upstream، purge Cloudflare cache. لا تعمل rollback |
| جديد | قديم | قديم | PM2 لم يُعد التشغيل بالـ env الصحيح | `pm2 restart flowtixtools-web --update-env` |
| قديم | قديم | قديم | rsync فشل أو integrity rollback تفعّل | راجع logs خطوة "Install dependencies and restart SSR app" |
| جديد | 5xx | 5xx | الكود الجديد ينهار على SSR | راجع `pm2 logs flowtixtools-web --lines 200`، اعمل rollback يدويًا إذا لزم |

---

## أوامر فحص آمنة على VPS

```bash
# قرص
cat /www/wwwroot/flowtixtools.com/deploy-version.json

# محلي على VPS
curl -fsS http://127.0.0.1:3100/deploy-version.json
curl -fsS http://127.0.0.1:3100/api/public/health

# عام مع تجاوز الكاش
curl -fsS -H "Cache-Control: no-cache" \
  "https://www.flowtixtools.com/deploy-version.json?ts=$(date +%s)"

# PM2
pm2 list
pm2 describe flowtixtools-web
pm2 logs flowtixtools-web --lines 200 --nostream

# Nginx upstream
sudo grep -rHnE "(127\.0\.0\.1|localhost):[0-9]+" /www/server/panel/vhost/nginx
sudo nginx -t && sudo nginx -s reload
```

---

## متى نعمل rollback ومتى لا

**نعمل rollback تلقائي** عندما:
- التطبيق المحلي على `127.0.0.1:3100` لا يخدم الـSHA الجديد، أو
- التطبيق المحلي يرجع 5xx على مسارات حرجة (homepage / health / dashboard).

**لا نعمل rollback** عندما:
- التطبيق المحلي سليم لكن الدومين العام يرجع خطأ → المشكلة في Nginx أو
  Cloudflare. rollback لن يحل المشكلة، فقط يخفي نسخة شغالة خلف edge مكسور.
  أصلح البروكسي/الكاش وأعد المحاولة.

### سلوك Auto-Rollback في GitHub Actions

عند فشل أي خطوة من الـdeploy (بناء، rsync، PM2 restart، health check…)،
يشغّل الـworkflow خطوة **Auto-rollback on failure** التي تعمل تلقائيًا:

1. **اختيار snapshot** بالترتيب: `LAST_GOOD` (آخر نسخة موثوقة بعد smoke-test كامل)
   → `PREV_SNAPSHOT` (ما كان شغال قبل الـdeploy الفاشل) → أحدث `good-*` →
   أحدث snapshot خام `[0-9]*`، ثم محاولة أخيرة بـ`PREV_SNAPSHOT/raw` حتى لو
   كان يحمل نفس SHA الفاشل عند عدم وجود أي بديل صالح.
2. **التحقق من صلاحية** المرشح (وجود `dist/server/*`, `ecosystem.config.cjs`,
   `node_modules`) قبل النسخ.
3. **رفض أي snapshot يحمل نفس SHA الفاشل** في المسار الطبيعي حتى لو كان موجودًا
   خطأً في `LAST_GOOD` من محاولة سابقة؛ يُسمح به فقط كحل أخير للـpre-deploy
   snapshots لمنع الوقوف عند `no_valid_snapshot`.
4. **rsync + PM2 reload + pm2 save** على النسخة المختارة.
5. **Local health check** على `127.0.0.1:$APP_PORT` لمدة 60 ثانية.
6. **Public domain verify** على الدومين العام (200 OK).
7. **مسح `.deploy/last-sha`** الفاشل حتى لا يُتخطّى الـdeploy التالي بالخطأ.
8. **تقرير في GitHub Step Summary** يوضح: السبب، الـsnapshot المُستعاد،
   الـSHA الحالي.

مهم: لا يتم تحديث `LAST_GOOD` الآن إلا بعد نجاح فحص الصفحة الرئيسية و
`/api/public/health` و`deploy-version.json`؛ لذلك لا يمكن اعتبار نسخة ترجع
500 كـ “آخر نسخة ناجحة”.

فشل خطوة الاستعادة نفسها أصبح warning فقط حتى لا يستبدل سبب الفشل الأصلي
برسالة مضللة مثل `no_valid_snapshot`. لا حاجة لتدخل يدوي إلا لو فشل
سبب النشر الأصلي أو كان الموقع العام ما زال غير صحي.

#### Public domain check (وضع متساهل)

- خطوة **public domain check** الأصلية لم تعد تُسقط الـworkflow تلقائيًا
  إذا كان التطبيق شغال محليًا على الـVPS لكن الدومين العام ما زال يتذبذب
  بسبب cache / proxy / vhost.
- فحص الدومين بعد **rollback** أيضًا أصبح متساهلًا بنفس القاعدة: نجاح
  الاستعادة محليًا هو مصدر الحقيقة، أما 5xx على الدومين العام بعد ذلك فهو
  warning ما لم يكن `STRICT_PUBLIC_DOMAIN_CHECK=true`.
- لتفعيل السلوك الصارم: أضف متغير GitHub Actions باسم
  `STRICT_PUBLIC_DOMAIN_CHECK=true`.
- الفحص العام يتبع redirects، ويضيف cache-busting querystring، ويرسل
  `Cache-Control: no-cache`، ويطلب 3 نجاحات متتالية.

---

## مسارات الـsmoke test في النشر

كل deploy يفحص هذه المسارات تلقائيًا. أي فشل = النشر يعتبر غير صحي:

- `GET /` → 200 + HTML
- `GET /api/public/health` → 200 + `"status":"ok"`
- `GET /deploy-version.json` → يحتوي `short_sha` الجديد
- `GET /dashboard`, `/dashboard/facebook`, `/dashboard/facebook/bot`,
  `/dashboard/facebook/groups`, `/dashboard/whatsapp`, `/dashboard/profile`
  → أي 2xx/3xx مقبول، أي 5xx فشل.

---

## ملاحظة على دوال خادم محمية في loaders

مسارات `/dashboard/*` تعمل بـ `ssr: false` لأن محتواها خاص بالمستخدم
ولا يحتاج SSR. لا تستدعي `createServerFn().middleware([requireSupabaseAuth])`
داخل `loader` لمسار عام؛ استخدمها من `useServerFn` + `useQuery` داخل
المكوّن. مخالفة هذا تسبب 500/502 وقت SSR بدون جلسة.
