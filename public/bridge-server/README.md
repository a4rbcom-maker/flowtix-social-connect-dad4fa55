# WhatsApp Bridge Server - Flowtix Platform

سكربت خادم Bridge جاهز للتنصيب، متوافق مع منصة Flowtix، ويدعم استقبال/إرسال النصوص والوسائط والمستندات عبر WhatsApp Web.

## الميزات

- لوحة مراقبة مرئية مدمجة على المسار `/`
- فحص صحة عبر `/health` و `/api/health`
- إدارة جلسات WhatsApp Web عبر Baileys
- إرسال/استقبال رسائل نصية ووسائط ومستندات
- حماية بـ API Key
- دعم Docker للنشر السريع
- حفظ الجلسات خارج الحاوية + نسخ احتياطي تلقائي قبل التحديث
- Watchdog يعيد تشغيل الجسر تلقائياً لو فحص الصحة فشل بدون حذف الجلسات

## المتطلبات

- VPS بنظام Ubuntu 20.04+
- Docker و Docker Compose
- دومين HTTPS اختياري لكنه موصى به

## التنصيب السريع

### 1. انسخ الملفات إلى VPS

```bash
mkdir -p /opt/wa-bridge && cd /opt/wa-bridge
```

### 2. ارفع ملفات الجسر

ارفع محتويات هذا المجلد كما هي إلى السيرفر:

- `server.js`
- `package.json`
- `Dockerfile`
- `docker-compose.yml`
- `deploy.sh`
- `bridge-watchdog.sh`
- `disk-guard.sh`

### 3. اضبط المتغيرات

أنشئ ملف `.env` بجانب `docker-compose.yml`:

```bash
API_KEY=your-secure-api-key-here
WEBHOOK_URL=https://your-flowtix-domain.com/api/public/hooks/wa-webhook
WEBHOOK_SECRET=your-webhook-secret-here
```

استخدم نفس قيمة `API_KEY` و `WEBHOOK_SECRET` الموجودة في إعدادات الجسر داخل المنصة.

### 4. شغّل الخادم

الأفضل تشغيل سكربت النشر المرفق لأنه يحفظ نسخة احتياطية من الجلسات، يعيد البناء بأمان، ويفحص الصحة تلقائياً:

```bash
bash deploy.sh
```

أو يدوياً:

```bash
mkdir -p sessions backups logs
docker compose up -d --build
curl -i http://127.0.0.1:3000/health
```

> مهم: لا تستخدم `docker rm -f wa-bridge` ولا `docker compose down -v` مع هذا الخادم؛ لأن الإيقاف العنيف أو حذف الـ volumes قد يسبب فقدان/تلف جلسات WhatsApp.

## تحديث الجسر الخارجي لإصلاح الوسائط

بعد رفع الملفات الجديدة للسيرفر الخارجي، نفّذ من داخل مجلد الجسر:

```bash
bash deploy.sh
curl -s http://127.0.0.1:3000/health
```

يجب أن يظهر رقم النسخة مطابقاً لقيمة `version` في `package.json`.

## إعداد HTTPS اختيارياً عبر Caddy

```bash
sudo apt install caddy
```

أضف في `/etc/caddy/Caddyfile`:

```caddy
wa-bridge.yourdomain.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl restart caddy
```

## API Endpoints

| Method | Endpoint | Auth | الوصف |
|---|---|---|---|
| GET | `/` | لا | لوحة المراقبة المرئية |
| GET | `/health` | لا | فحص الصحة الأساسي |
| GET | `/api/health` | نعم | فحص صحة مفصّل |
| GET | `/api/diagnostics` | نعم | تشخيص Docker/ffmpeg/الجلسات |
| POST | `/api/deep-health` | نعم | فحص إنشاء جلسة QR مؤقتة |
| POST | `/api/restart` | نعم | إعادة تشغيل عملية Bridge داخل الحاوية |
| POST | `/api/sessions` | نعم | إنشاء جلسة جديدة |
| GET | `/api/sessions` | نعم | قائمة الجلسات |
| GET | `/api/sessions/:id/qr` | نعم | الحصول على QR Code |
| GET | `/api/sessions/:id/status` | نعم | حالة الجلسة |
| POST | `/api/sessions/:id/send` | نعم | إرسال رسالة |
| DELETE | `/api/sessions/:id` | نعم | حذف/فصل جلسة |

## حماية القرص

امتلاء القرص قد يمنع Baileys من كتابة ملفات الجلسات بسرعة، وهذا يؤدي إلى انقطاع أو فشل إرسال/استقبال. لتفعيل الحارس التلقائي:

```bash
chmod +x disk-guard.sh
( crontab -l 2>/dev/null | grep -v disk-guard.sh ; \
  echo "0 * * * * cd $(pwd) && ./disk-guard.sh >> logs/disk-guard.log 2>&1" ) | crontab -
```

## استكشاف الأخطاء

- `502 Bad Gateway`: الحاوية متوقفة؛ نفّذ `bash deploy.sh` ثم افحص `docker logs wa-bridge --tail 120`.
- لا تظهر ملفات PDF/الصوت/الفيديو: تأكد أن `/health` يعرض النسخة الجديدة بعد النشر، ثم أعد طلب مزامنة المحادثات من المنصة.
- لا يظهر QR: تأكد أن الجلسة غير موجودة مسبقاً أو استخدم إصلاح الجلسة من المنصة.
- انقطاع متكرر: شغّل `bash deploy.sh` لتفعيل watchdog، وتأكد أن مجلد `sessions` مثبت في Docker.