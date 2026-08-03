# Quickstart: التحقق من ميزة إثراء البيانات

**Feature**: 005-data-enrichment | **Date**: 2026-07-30

---

## المتطلبات المسبقة

1. **ملفات SQLite في مكانها**: `extraction-service/db/egypt.db` و/أو `extraction-service/db/Iraq.db`
2. **extraction-service يعمل**: `cd extraction-service && npm run dev`
3. **جلسة Facebook متصلة** و**مهمة استخراج جاهزة**
4. **`better-sqlite3` مُثبّت**: `cd extraction-service && npm install better-sqlite3`

---

## السيناريو 1: إثراء تلقائي بعد استخراج أعضاء جروب

### الخطوات

1. ابدأ عملية استخراج أعضاء جروب من Facebook
2. انتظر اكتمال الاستخراج (status = `completed`)
3. راقب سجلات extraction-service

### النتائج المتوقعة في الـ logs

```
[Enrichment] starting enrichment for job <id>: 87 results
[Enrichment] loaded egypt.db (readonly)
[Enrichment] batch 1/1: searching 87 FBIDs in egypt.db
[Enrichment] found 52 matches in egypt.db
[Enrichment] loaded Iraq.db (readonly)
[Enrichment] batch 1/1: searching 35 remaining FBIDs in Iraq.db
[Enrichment] found 8 matches in Iraq.db
[Enrichment] updating 60 results with enrichment data
[Enrichment] done: 60/87 enriched (69% coverage)
```

### التحقق

- مهمة الاستخراج في `extraction_jobs` تحتوي `progress.enrichment` بالأرقام
- سجلات `extraction_results` المُثراة تحتوي `metadata.enrichment` بالبيانات

---

## السيناريو 2: تصدير بيانات مُثراة كـ CSV

### الخطوات

1. بعد إثراء مهمة مكتملة (السيناريو 1)
2. اضغط زر "CSV" في صفحة المهام
3. افتح الملف المُنزّل

### النتائج المتوقعة

الـ CSV يحتوي أعمدة إضافية:
```
id,name,profile_url,avatar_url,phone,first_name,last_name,gender,hometown,location,work,email
100006575975816,أحمد محمد,https://...,,201110598247,احمد,محمد,male,Giza,Giza,None,
100010418739632,على عبد الفضيل,https://...,,201110598257,على,غبد الفضيل,male,None.,None.,None,
999999999999999,مستخدم غير موجود,https://...,,,,,,,,,,,
```

المستخدم غير الموجود في قاعدة البيانات: أعمدة الإثراء فارغة.

---

## السيناريو 3: تصدير JSON مع بيانات إثراة

### الخطوات

1. اضغط زر "JSON" في صفحة المهام

### النتائج المتوقعة

```json
[
  {
    "id": "100006575975816",
    "name": "أحمد محمد",
    "profile_url": "https://...",
    "avatar_url": "",
    "enrichment": {
      "phone": "201110598247",
      "first_name": "احمد",
      "last_name": "محمد",
      "gender": "male",
      "hometown": "Giza",
      "location": "Giza",
      "work": "None",
      "email": null,
      "source_db": "egypt"
    }
  },
  {
    "id": "999999999999999",
    "name": "مستخدم غير موجود",
    "profile_url": "https://...",
    "avatar_url": "",
    "enrichment": null
  }
]
```

---

## السيناريو 4: إثراء بدون ملفات SQLite

### الخطوات

1. أزل كل ملفات `.db` من مجلد `extraction-service/db/`
2. أكمل عملية استخراج

### النتائج المتوقعة

- الـ logs: `[Enrichment] no SQLite databases found in ./db — skipping enrichment`
- الاستخراج يكتمل بشكل طبيعي بدون إثراء
- لا أخطاء، لا توقف

---

## السيناريو 5: قاعدة بيانات تالفة جزئياً

### الخطوات

1. استخدم `egypt.db` التالف الموجود حالياً
2. أكمل عملية استخراج

### النتائج المتوقعة

- الـ logs: `[Enrichment] batch 1 failed: database disk image is malformed — retrying with smaller batch`
- الدفعات الصغيرة تنجح (الاستعلامات المفهرسة تعمل)
- الإثراء يكتمل جزئياً مع تسجيل الأخطاء
- البيانات المُثراة الجزئية محفوظة

---

## التحقق من قاعدة البيانات

```sql
-- التحقق من بيانات الإثراء في النتائج
SELECT fb_id, data->>'name' as name, metadata->'enrichment'->>'phone' as phone
FROM extraction_results
WHERE job_id = '<job_id>'
AND metadata->'enrichment' IS NOT NULL
LIMIT 10;

-- إحصائيات الإثراء في المهمة
SELECT progress->'enrichment' FROM extraction_jobs WHERE id = '<job_id>';
```
