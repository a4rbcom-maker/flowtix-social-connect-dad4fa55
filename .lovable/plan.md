# خطة نهائية آمنة: إصلاح EADDRINUSE و502 على البورت 3001

## السبب الجذري

1. **عملية قديمة (zombie) ماسكة البورت 3001** — إما PM2 سابق أو Node مباشر أو سيرفر dev قديم.
2. **PM2 بيعيد التشغيل بسرعة** قبل ما الـ socket يتحرر، فبيدخل في loop من EADDRINUSE.
3. **احتمال وجود نسختين PM2** (واحدة تحت `root` وواحدة تحت user آخر زي `khaled` أو `www`)، فكل واحدة ماسكة عمليتها.

## الخطة الآمنة (نفّذها كـ root)

**ممنوع في هذه الخطة:** `pm2 kill`، `pm2 delete all`، `pkill -f node`،
`fuser -k 3001/tcp`، أو `systemctl restart nginx`. هذه أوامر واسعة وقد تؤثر على
جلسة الشل أو مواقع أخرى. نوقف فقط تطبيق PM2 باسم `flowtixtools-web`، ولا نقتل أي
PID على البورت إلا إذا ثبت أنه Node الخاص بمجلد `/www/wwwroot/flowtixtools.com`.

### الخطوة 1: تحديد كل العمليات الماسكة للبورت

```bash
sudo ss -ltnp 'sport = :3001'
sudo lsof -iTCP:3001 -sTCP:LISTEN -P -n
```
المخرج هيقول لنا الـ PID والـ user اللي شغّال العملية.

### الخطوة 2: إيقاف تطبيق Flowtix فقط داخل PM2

```bash
pm2 delete flowtixtools-web 2>/dev/null || true
```

### الخطوة 3: لو البورت ما زال مشغولًا، لا تقتله إلا بعد التحقق من مالكه

```bash
sudo ss -ltnp 'sport = :3001' || true
sudo lsof -iTCP:3001 -sTCP:LISTEN -P -n || true
```

### الخطوة 4: تعطيل أي systemd service قديم (لو موجود)

```bash
sudo systemctl list-units --type=service | grep -iE "flowtix|tanstack|node" || echo "مفيش service"
# لو لقيت service:
# sudo systemctl disable --now <service-name>
```

### الخطوة 5: تشغيل نظيف من ecosystem الموحّد

استخدم نفس الـ ecosystem اللي عملناه قبل كده مع إضافة `kill_timeout` و `wait_ready` و `listen_timeout` عشان PM2 ميعيدش التشغيل بسرعة:

```js
// /root/flowtixtools-web.ecosystem.config.cjs
module.exports = {
  apps: [{
    name: "flowtixtools-web",
    cwd: "/www/wwwroot/flowtixtools.com",
    script: "scripts/tanstack-node-server.mjs",
    interpreter: "node",
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    max_restarts: 5,
    min_uptime: "10s",
    restart_delay: 3000,
    kill_timeout: 5000,
    env: {
      NODE_ENV: "production",
      PORT: "3001",
      HOST: "127.0.0.1",
      BOT_WORKER_SECRET: "<من /home/khaled/flowtix-worker/.env>",
      CRON_SECRET: "<نفس القيمة>"
    }
  }]
}
```

ثم:
```bash
sudo pm2 start /root/flowtixtools-web.ecosystem.config.cjs --only flowtixtools-web --update-env
sudo pm2 save
```

### الخطوة 6: اختبار

```bash
sleep 5
sudo pm2 list
sudo pm2 logs flowtixtools-web --lines 30 --nostream
curl -i -sS -X POST http://127.0.0.1:3001/api/public/bot/next-job | head -5
curl -i -sS -X POST https://flowtixtools.com/api/public/bot/next-job | head -5
```

**النتيجة المتوقعة:** `401 Unauthorized` في الاختبارين = الكل شغّال صح.

## ملاحظة فنية

- لو الخطوة 1 أظهرت إن العملية الماسكة للبورت بتاعت user تاني (مش root)، لازم نشتغل بنفس الـ user (مثلاً `sudo -u khaled -H pm2 ...`) عشان نضمن إن PM2 instance الصح هو اللي يدير العملية. اشتغال نسختين PM2 لـ users مختلفين على نفس البورت = مصدر الـ loop.
- `kill_timeout: 5000` بيدي العملية وقت ترجع SIGTERM قبل SIGKILL، و `restart_delay: 3000` بيدي الـ socket وقت يتحرر.

هل أنفذ الخطة دي كأوامر جاهزة للنسخ؟
