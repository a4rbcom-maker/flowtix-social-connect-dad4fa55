# دليل نشر FlowTix على VPS — aaPanel

> هذا الدليل يفترض أن لديك VPS مع **aaPanel** و **Node.js** مركب، ودومين `flowtixtools.com`.

---

## الخطوة 1: إنشاء الموقع في aaPanel

### الواجهة (flowtixtools.com)
1. aaPanel → **Website → Add Site**
2. Domain: `flowtixtools.com`
3. Type: **Static** (الواجهة مبنية بالفعل في `dist/`)
4. Path: `/www/wwwroot/flowtixtools.com`

### خدمة الاستخراج (api.flowtixtools.com)
1. aaPanel → **Website → Add Site**
2. Domain: `api.flowtixtools.com`
3. Type: **Reverse Proxy**
4. Target URL: `http://127.0.0.1:3100`
5. Path: `/www/wwwroot/api.flowtixtools.com`

> إذا لم يكن Reverse Proxy متاحاً مباشرة، أنشئه كـ **PHP/Node site** ثم أضف الـ reverse proxy يدوياً في إعدادات Nginx (انظر الخطوة 3).

---

## الخطوة 2: تفعيل SSL

لكل موقع:
1. اضغط على الموقع → **SSL → Let's Encrypt**
2. فعّل SSL و اختر **Force HTTPS**
3. هذا سيمنحك:
   - `https://flowtixtools.com`
   - `https://api.flowtixtools.com`

---

## الخطوة 3: إعداد Nginx Reverse Proxy لخدمة الاستخراج

في aaPanel → Website → `api.flowtixtools.com` → **Config** (أو Nginx)، أضف داخل `server { ... }`:

```nginx
location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    
    # WebSocket support (للـ WhatsApp / Realtime)
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
}
```

> **تنبيه**: احذف أي `location / { try_files ... }` افتراضي من aaPanel قبل إضافة الكود أعلاه.

---

## الخطوة 4: تثبيت PM2 + Playwright

SSH إلى السيرفر ثم:

```bash
# تثبيت PM2 عالمياً
npm install -g pm2

# تفعيل PM2 مع إقلاع النظام
pm2 startup
pm2 resurrect
```

---

## الخطوة 5: GitHub Secrets المطلوبة

في GitHub repo → Settings → Secrets and variables → Actions، أضف:

| Secret | القيمة |
|--------|--------|
| `SERVER_IP` | IP الـ VPS |
| `SSH_PORT` | 22 (أو المنفذ المخصص) |
| `SERVER_USER` | root (أو المستخدم المخصص) |
| `SSH_PRIVATE_KEY` | محتوى مفتاح SSH الخاص |
| `VITE_SUPABASE_URL` | `https://ukjrizflmkutadsrcmut.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon key |
| `VITE_EXTRACTION_API_URL` | `https://api.flowtixtools.com` |
| `VITE_EXTRACTION_API_KEY` | `flowtix-extraction-2026` |
| `SUPABASE_URL` | `https://ukjrizflmkutadsrcmut.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key من Supabase Dashboard |

---

## الخطوة 6: النشر الأول (يدوي)

بعد إعداد aaPanel و Nginx، ادفع الكود لفرع `main`:

```bash
git push origin main
```

سيقوم GitHub Actions تلقائياً بـ:
1. بناء الواجهة ونشرها على `flowtixtools.com`
2. بناء خدمة الاستخراج ونشرها على `api.flowtixtools.com` مع PM2

### التحقق:
```bash
# فحص حالة الخدمة
pm2 status
pm2 logs flowtix-extraction

# فحص Nginx
curl -I https://api.flowtixtools.com/health -H "X-API-Key: flowtix-extraction-2026"

# فحص الواجهة
curl -I https://flowtixtools.com
```

---

## استكشاف الأخطاء

### الخدمة لا تعمل
```bash
pm2 logs flowtix-extraction --lines 50
```

### Playwright لا يعمل
```bash
npx playwright install-deps chromium
npx playwright install chromium
```

### Nginx يعطي 502
- تأكد أن المنفذ 3100 يعمل: `curl http://127.0.0.1:3100/health -H "X-API-Key: flowtix-extraction-2026"`
- أعد تشغيل Nginx: `nginx -t && nginx -s reload`

### CORS Errors
- تأكد من `ALLOWED_ORIGINS` في `/www/wwwroot/api.flowtixtools.com/.env`
- يجب أن يحتوي على `https://flowtixtools.com`
