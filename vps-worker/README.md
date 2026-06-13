# Flowtix VPS Worker — دليل التشغيل

Worker مستقل تمامًا، يعمل في مجلده الخاص بـ Node.js + Playwright. لا يلامس Nginx ولا أي موقع آخر على السيرفر.

## ما يفعله
- يستدعي `https://flowtixtools.com/api/public/bot/next-job` كل 5 ثوانٍ.
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
عدّل القيمتين:
- `API_BASE_URL=https://flowtixtools.com`
- `BOT_WORKER_SECRET=` — نفس القيمة الموجودة في Lovable Cloud (أنا أمتلكها لكن لا أستطيع إظهارها لك؛ افتح Project Settings → Secrets في Lovable لتأخذ نسخة، أو اطلب مني تدويرها).

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
