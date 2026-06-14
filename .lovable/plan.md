# خطة نهائية: إصلاح EADDRINUSE على البورت 3001

## السبب الجذري

1. **عملية قديمة (zombie) ماسكة البورت 3001** — إما PM2 سابق أو Node مباشر أو سيرفر dev قديم.
2. **PM2 بيعيد التشغيل بسرعة** قبل ما الـ socket يتحرر، فبيدخل في loop من EADDRINUSE.
3. **احتمال وجود نسختين PM2** (واحدة تحت `root` وواحدة تحت user آخر زي `khaled` أو `www`)، فكل واحدة ماسكة عمليتها.

## الخطة (نفّذها كـ root)

### الخطوة 1: تحديد كل العمليات الماسكة للبورت

```bash
sudo ss -ltnp 'sport = :3001'
sudo lsof -iTCP:3001 -sTCP:LISTEN -P -n
```
المخرج هيقول لنا الـ PID والـ user اللي شغّال العملية.

### الخطوة 2: إيقاف كل نسخ PM2 لكل المستخدمين

```bash
# لكل user محتمل
for u in root khaled www www-data; do
  sudo -u "$u" -H pm2 delete all 2>/dev/null || true
  sudo -u "$u" -H pm2 kill 2>/dev/null || true
done
```

### الخطوة 3: قتل أي عملية متبقية على البورت

```bash
sudo fuser -k -TERM 3001/tcp || true
sleep 2
sudo fuser -k -KILL 3001/tcp || true
sleep 2
# تأكيد إن البورت فاضي
sudo ss -ltnp 'sport = :3001' && echo "لسه مشغول ❌" || echo "البورت فاضي ✅"
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
sudo pm2 start /root/flowtixtools-web.ecosystem.config.cjs
sudo pm2 save
sudo pm2 startup systemd -u root --hp /root
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
