# Deployment Runbook — flowtixtools.com (VPS)

دليل تشغيل قصير لتشخيص فشل النشر بسرعة بدون تخمين. مصدر الحقيقة هو
`deploy-version.json` على القرص في `$DEPLOY_PATH` على الـVPS.

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

### سلوك GitHub Actions الحالي

- بعد هذا التعديل، خطوة **public domain check** لم تعد تُسقط الـworkflow تلقائيًا
  إذا كان التطبيق شغال محليًا على الـVPS لكن الدومين العام ما زال يتذبذب بسبب
  cache / proxy / vhost.
- النجاح النهائي يعتمد أولًا على **local SSR health**.
- لو تريد السلوك الصارم القديم، أضف متغير GitHub Actions باسم:

```bash
STRICT_PUBLIC_DOMAIN_CHECK=true
```

- الفحص العام نفسه صار أقوى: يتبع redirects، ويضيف cache-busting querystring،
  ويرسل `Cache-Control: no-cache`، ويطلب 3 نجاحات متتالية بدل أن يفشل بسبب
  رد واحد قديم عابر.

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
