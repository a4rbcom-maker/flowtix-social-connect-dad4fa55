## الإصلاح الدقيق — bug في استخراج المسارات من SHA256SUMS

### السبب الجذري المثبت
في `.github/workflows/deploy.yml` السطر 650:
```bash
awk '{ $1=""; sub(/^  /,""); print }' SHA256SUMS | LC_ALL=C sort > "$EXPECTED_LIST"
```

`sha256sum` يفصل HASH عن PATH بـ **مسافتين بالضبط**. لمّا `awk` يقسّم على whitespace ويعيد بناء السطر بـ `$1=""` يصير الفاصل **مسافة واحدة**. ثم `sub(/^  /,"")` يحاول حذف مسافتين — لا يطابق. النتيجة: كل مسار يبدأ بمسافة شاذة `" ./foo"` بينما `find -printf './%P\n'` ينتج `"./foo"`.

→ 100% disjoint → `file-list-drift` يفشل في كل deploy → `integrity_rollback` ينطلق → ما يلقى snapshot سليم → exit 1.

الأرقام في الصورة تأكيد قاطع: Missing=28548 (كل الـ manifest)، Extra=28552 (كل ما على VPS).

### التغيير الوحيد المطلوب

**ملف:** `.github/workflows/deploy.yml`  
**السطر:** 650 فقط.

**قبل:**
```bash
awk '{ $1=""; sub(/^  /,""); print }' SHA256SUMS | LC_ALL=C sort > "$EXPECTED_LIST"
```

**بعد:**
```bash
sed 's/^[0-9a-f]\{64\}  //' SHA256SUMS | LC_ALL=C sort > "$EXPECTED_LIST"
```

`sed` يحذف بدقة 64 hex char + مسافتين، يبقى المسار `./foo` بدون أي تشويه. مطابق 100% لمخرج `find -printf './%P\n'`.

### ما لا نلمسه
- منطق `integrity_rollback` و `is_valid_ssr_snapshot` و `is_runnable_prev_snapshot` → سليم، كان يحمينا فعلاً من النشر بـ bundle مزعوم تالف.
- خطوة Auto-fix Nginx و Verify upstream → مستقلة، لا علاقة.
- `Snapshot current site` و حذف الـ snapshots القديمة → فيها سؤال ثانوي عن "directory missing" لـ PREV_SNAPSHOT، لكن ما راح يطفو طالما الفحص الأساسي ما يفشل خطأً. نأجّله.

### التحقق بعد التعديل
1. `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"` للتأكد من صحة الـ YAML.
2. لا نشغّل build هنا — هذا تعديل في workflow فقط.
3. عند الـ deploy التالي، نتوقع في اللوج:
   ```
   Missing on VPS: 0
   Extra on VPS: 0
   ✓ VPS file count matches manifest exactly
   → Proceeding to PM2 restart
   ```

### Side-effect متوقع وإيجابي
بعد أول deploy ناجح، يُسجَّل `LAST_GOOD`، فأي failure مستقبلي يقدر يعمل auto-restore حقيقي — وهذا اللي خطة `.lovable/plan.md` القديمة كانت تحاول تتحايل عليه بتخفيف الشروط (وهو حل خاطئ لأن المشكلة لم تكن أصلاً في شروط الـ snapshot).
