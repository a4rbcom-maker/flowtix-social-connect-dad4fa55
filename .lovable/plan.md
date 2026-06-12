## الهدف
إيقاف دوامة الفشل والتكرار في GitHub Actions عبر تحويل النشر إلى مسار واحد واضح، بقفل حقيقي على السيرفر، ورسائل خطأ تحدد السبب الفعلي بدل `exit code 1` فقط.

## ما سأغيّره بعد الموافقة

1. **تبسيط workflow النشر بدل الترقيعات المتراكمة**
   - تقليل `.github/workflows/deploy.yml` من ملف طويل ومعقد إلى خطوات أساسية فقط: checkout، install، build، تجهيز bundle، rsync، restart، health check.
   - إزالة بوابات كثيرة تسبب فشل أحمر حتى لو التطبيق على السيرفر يعمل، مثل فحوصات Nginx/CDN الصارمة وفحص public SHA المتكرر.

2. **قفل نشر حقيقي داخل الـ VPS**
   - إضافة lock file على السيرفر باستخدام `flock` داخل `$DEPLOY_PATH/.deploy/deploy.lock`.
   - إذا بدأ trigger ثاني لنفس الوقت، ينتظر أو يخرج برسالة واضحة بدل تشغيل Deploy مرتين.
   - إضافة marker على السيرفر باسم آخر SHA تم نشره، فإذا نفس الـ SHA موجود مسبقاً يتم تخطي النشر بأمان.

3. **منع تكرار GitHub Actions من المصدر**
   - الإبقاء على trigger واحد فعلي للنشر: `push` + `workflow_dispatch` فقط.
   - استخدام `concurrency` على مستوى الـ workflow باسم المستودع حتى لا يلمس الـ VPS أكثر من Run واحد في نفس الوقت.
   - إبقاء CI منفصل للـ PR/manual فقط بدون تشغيل Build/Deploy مكرر على كل push.

4. **جعل سبب الفشل واضحاً داخل GitHub**
   - كل خطوة ستطبع سبب فشل محدد: missing secret، build failed، SSH failed، rsync failed، PM2 failed، health failed.
   - لن نعتمد على Cache GitHub كقفل deploy لأن فشله/تأخره سبب محتمل للّخبطة.

5. **الإبقاء على rollback والنسخ الاحتياطي بشكل أبسط**
   - أخذ snapshot قبل rsync.
   - إذا فشل health check المحلي على السيرفر، يتم إرجاع آخر snapshot وإعادة تشغيل PM2.
   - الفحص النهائي سيكون محلياً على `127.0.0.1:$APP_PORT` لأنه مصدر الحقيقة المباشر، وليس CDN أو Nginx.

## تفاصيل تقنية مختصرة

- الملف الأساسي: `.github/workflows/deploy.yml`
- السكربت الموجود: `scripts/ci/install-restart.sh`
- سأحافظ على الأسرار الحالية:
  - `SSH_PRIVATE_KEY`
  - `SERVER_USER` أو `SSH_USER`
  - `SERVER_IP` أو `SSH_HOST`
  - اختياري: `SSH_PORT`, `DEPLOY_PATH`, `APP_NAME`, `APP_PORT`, `PUBLIC_URL`
- لن أضيف اسم المستودع داخل الكود، وسيبقى workflow صالحاً للمستودع الحالي أو غيره.

## النتيجة المتوقعة

بعد التطبيق، أي push جديد يجب أن يعطي واحدة من حالتين فقط:

```text
نجاح: تم بناء ونشر SHA واحد مرة واحدة فقط.
أو فشل واضح: step محددة + سبب مباشر قابل للإصلاح.
```

بهذا ننهي التكرار والترقيعات، ونحوّل النشر إلى مسار بسيط وقابل للتشخيص.