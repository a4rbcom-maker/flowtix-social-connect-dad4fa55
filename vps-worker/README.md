# Flowtix VPS Worker — دليل التشغيل

Worker مستقل تمامًا، يعمل في مجلده الخاص بـ Node.js + Playwright. لا يلامس Nginx ولا أي موقع آخر على السيرفر، ولا يلمس Bot‑Xtra Bridge نهائياً.

## ما يفعله
- يستدعي `https://flowtix-social-connect.lovable.app/api/public/bot/next-job` كل 5 ثوانٍ.
- عند استلام مهمة: يفتح Chromium بكوكيز الحساب، ينفّذ المهمة، ويرسل النتائج إلى `/api/public/bot/job-update`.
- مدعوم حاليًا: **استخراج المعلقين من بوست (`extract_commenters`)**. باقي الأنواع تُعلَّم كـ "غير مدعومة" مع رسالة واضحة (يمكن تطويرها لاحقًا).

---

## خطوات النشر (Copy / Paste)

### 1) إنشاء يوزر منعزل (مرة واحدة فقط)
```bash
sudo adduser --disabled-password --gecos "" flowtix
sudo mkdir -p /home/flowtix && sudo chown -R flowtix:flowtix /home/flowtix
```

### 2) نسخ كود الـ worker إلى السيرفر
المشروع متزامن من GitHub عندك. انسخ مجلد `vps-worker/` فقط إلى يوزر `flowtix`:
```bash
# اضبط المسار حسب مكان مزامنة الريبو على السيرفر
sudo cp -r /path/to/your/repo/vps-worker /home/flowtix/
sudo chown -R flowtix:flowtix /home/flowtix/vps-worker
```

### 3) تثبيت Node.js 20 (لو غير مثبت)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 4) تثبيت Worker + متصفح Chromium
```bash
sudo -u flowtix -i
cd ~/vps-worker
npm install
npx playwright install --with-deps chromium
exit
```

### 5) إنشاء ملف `.env`
```bash
sudo -u flowtix cp /home/flowtix/vps-worker/.env.example /home/flowtix/vps-worker/.env
sudo -u flowtix nano /home/flowtix/vps-worker/.env
```
عدّل القيمتين فقط:
- `API_BASE_URL=https://flowtix-social-connect.lovable.app`
- `BOT_WORKER_SECRET=` — نفس قيمة السر الموجود في إعدادات المشروع باسم `BOT_WORKER_SECRET`.

> لا تستخدم هنا `WA_BRIDGE_URL` أو `WA_BRIDGE_API_KEY` أو `WA_BRIDGE_WEBHOOK_SECRET`؛ هذه تخص Bot‑Xtra فقط وليست مطلوبة لفيسبوك.

### 6) تثبيت السيرفس
```bash
sudo cp /home/flowtix/vps-worker/flowtix-worker.service /etc/systemd/system/
sudo touch /var/log/flowtix-worker.log
sudo chown flowtix:flowtix /var/log/flowtix-worker.log
sudo systemctl daemon-reload
sudo systemctl enable --now flowtix-worker
```

### 7) التحقق
```bash
sudo systemctl status flowtix-worker
sudo tail -f /var/log/flowtix-worker.log
```
يجب أن ترى: `Flowtix worker started → https://flowtixtools.com`

---

## التحديث لاحقًا
```bash
cd /home/flowtix/vps-worker
sudo -u flowtix git pull   # لو الفولدر نفسه فيه .git، أو انسخ يدويًا من ريبو aaPanel
sudo -u flowtix npm install
sudo systemctl restart flowtix-worker
```

## ممنوعات مهمة حتى لا تتأثر Bot‑Xtra
- لا تعمل restart لأي خدمة Bot‑Xtra أو WhatsApp bridge عند تحديث Facebook Worker.
- لا تغيّر متغيرات `WA_BRIDGE_*` على السيرفر.
- لا تغيّر Nginx أو aaPanel أو أي proxy خاص بواتساب.
- الخدمة الوحيدة المسموح بإعادة تشغيلها لفيسبوك هي: `flowtix-worker` فقط.

أوامر آمنة للتحديث بدون لمس Bot‑Xtra:
```bash
cd /path/to/your/repo
git pull
sudo rsync -a --delete vps-worker/ /home/flowtix/vps-worker/
sudo chown -R flowtix:flowtix /home/flowtix/vps-worker
sudo -u flowtix bash -lc 'cd /home/flowtix/vps-worker && npm install'
sudo systemctl restart flowtix-worker
sudo systemctl status flowtix-worker --no-pager
```

## إيقاف مؤقت
```bash
sudo systemctl stop flowtix-worker
```

## حذف نهائي (مع الإبقاء على باقي المواقع كما هي)
```bash
sudo systemctl disable --now flowtix-worker
sudo rm /etc/systemd/system/flowtix-worker.service
sudo rm -rf /home/flowtix/vps-worker
sudo deluser flowtix
```

---

## الضمانات بالنسبة لباقي مواقعك
- يعمل تحت يوزر مستقل (`flowtix`) — لا يستطيع تعديل ملفات مواقع أخرى.
- `ProtectSystem=full` + `ProtectHome=read-only` يمنعان الكتابة خارج مجلده.
- لا يفتح أي بورت ولا يتدخل في Nginx ولا aaPanel.
- استهلاك Chromium ~300-500MB RAM أثناء العمل، صفر تقريبًا أثناء الانتظار.
