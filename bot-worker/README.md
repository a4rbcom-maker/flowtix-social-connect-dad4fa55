# Flowtix VPS Bot Worker — دليل التركيب

سكريبت يشتغل على سيرفر VPS الخاص بك وبيتواصل مع موقع Flowtix لتنفيذ مهام النشر والاستخراج على فيسبوك تلقائياً.

## المتطلبات
- VPS بنظام Ubuntu 22.04+ (أو أي توزيعة Linux)
- Node.js 20+
- 2GB RAM كحد أدنى (Chromium يستهلك ذاكرة)

## خطوات التركيب

### 1. تجهيز السيرفر
```bash
# تثبيت Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# تثبيت dependencies اللي بيحتاجها Chromium
sudo apt install -y chromium-browser libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libasound2 fonts-noto-color-emoji
```

### 2. نسخ السكريبت
```bash
git clone <YOUR_REPO_URL> flowtix
cd flowtix/bot-worker
npm install
```

### 3. إعداد المتغيرات
```bash
cp .env.example .env
nano .env
```

ضع داخل `.env`:
- `API_BASE_URL=https://flowtix-social-connect.lovable.app` (أو دومينك)
- `BOT_WORKER_SECRET=` المفتاح اللي وُلِّد في إعدادات Lovable
- `HEADLESS=true`

### 4. تشغيل دائم بـ PM2
```bash
sudo npm install -g pm2
pm2 start index.js --name flowtix-bot
pm2 save
pm2 startup
```

### 5. متابعة الـ logs
```bash
pm2 logs flowtix-bot
```

## كيف يعمل النظام؟

1. الـ Worker يعمل polling كل 15 ثانية على `/api/public/bot/next-job`
2. لو مفيش مهام، الفاصل يزيد تلقائياً (exponential backoff) لحد 60 ثانية — لتقليل الضغط على السيرفر.
3. لما يلاقي مهمة، يفتح Chromium، يسجل دخول بالكوكيز/كلمة المرور المشفّرة، وينفّذ المهمة.
4. كل خطوة بتتبعت كـ `job-update` للموقع → الواجهة تتحدث live عبر Realtime.

## حل المشاكل

| مشكلة | الحل |
|------|-----|
| `Cannot find Chrome` | شغّل: `npx puppeteer browsers install chrome` |
| `Login failed` | حدّث الكوكيز من الإضافة (تنتهي صلاحيتها) |
| `Account requires checkpoint` | افتح الحساب يدوياً وأكّد الهوية، ثم حدّث الكوكيز |
| استهلاك RAM عالي | شغّل worker واحد بس على VPS بـ 2GB |

## تحذير أمني
- ⚠️ النشر التلقائي يخالف شروط فيسبوك وقد يؤدي لحظر الحساب.
- استخدم حسابات منفصلة، وفواصل زمنية ≥5 دقايق.
- لا تنشر نفس المحتوى حرفياً — استخدم `{{spin:نص1|نص2}}`.
