# API Contract: Enrichment Service (Internal)

**Feature**: 005-data-enrichment | **Service**: extraction-service (port 3100)

الإثراء خدمة داخلية (internal) — لا يُضاف endpoint جديد للواجهة. الإثراء يُنفّذ تلقائياً بعد اكتمال الاستخراج.

---

## 1. استدعاء الإثراء (داخلي)

### الدالة: `enrichmentService.enrichJobResults(jobId)`

**يُستدعى من**: `extract.ts` بعد اكتمال مهمة الاستخراج بنجاح (status = `completed`)

### Flow

```
1. جلب كل fb_ids من extraction_results WHERE job_id = jobId
2. فلترة: إزالة null/فارغ + إزالة msg_ prefix
3. فتح كل ملف SQLite متاح (readonly)
4. لكل دفعة (500 fb_id):
   a. SELECT FBID, Phone, first_name, last_name, email, gender, hometown, location, work FROM data WHERE FBID IN (...)
   b. تنظيف BOM prefix من النتائج
   c. بناء Map<fb_id, enrichment_row>
5. تحديث extraction_results.metadata = { enrichment: {...} } لكل تطابق
6. حفظ إحصائيات الإثراء في extraction_jobs.progress
7. إغلاق اتصالات SQLite
8. تسجيل ملخّص في الـ logs
```

### إحصائيات تُحفظ في `extraction_jobs.progress`

```json
{
  "enrichment": {
    "total": 100,
    "enriched": 60,
    "not_found": 40,
    "coverage_percent": 60,
    "sources": { "egypt": 45, "iraq": 15 }
  }
}
```

---

## 2. توسيع الـ Export (تعديل endpoint موجود)

### POST `/export` — إضافة أعمدة الإثراء

**الطلب الحالي**:
```json
{ "job_id": "uuid", "format": "csv" }
```

**رد CSV — بدون إثراء** (كما هو):
```
id,name,profile_url,avatar_url
```

**رد CSV — مع إثراء** (مُوسّع):
```
id,name,profile_url,avatar_url,phone,first_name,last_name,gender,hometown,location,work,email
```

**رد JSON — مع إثراء** (مُوسّع):
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
  }
]
```

**المنطق**: إذا `metadata.enrichment` موجود في السجل، أضف البيانات. إذا لم يوجد، أضف أعمدة فارغة في CSV أو `enrichment: null` في JSON.

---

## 3. متغيرات البيئة

| المتغير | الافتراضي | الوصف |
|---------|-----------|-------|
| `ENRICHMENT_DB_PATH` | `./db` | مسار مجلد ملفات SQLite |
| `ENRICHMENT_ENABLED` | `true` | تفعيل/تعطيل الإثراء التلقائي |
| `ENRICHMENT_BATCH_SIZE` | `500` | حجم الدفعة للبحث في SQLite |
