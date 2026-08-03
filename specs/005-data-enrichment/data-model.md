# Data Model: إثراء بيانات المستخدمين المستخرجة

**Feature**: 005-data-enrichment | **Date**: 2026-07-30

---

## التغييرات في الجداول الموجودة

### `extraction_results` — تحديث حقل `metadata`

حقل `metadata` موجود حالياً كـ `jsonb` بقيمة `{}`. سيُستخدم لحفظ بيانات الإثراء.

**شكل `metadata` بعد الإثراء**:

```json
{
  "enrichment": {
    "phone": "201110598247",
    "first_name": "احمد",
    "last_name": "محمد",
    "email": null,
    "gender": "male",
    "hometown": "Giza",
    "location": "Giza",
    "work": "Software Engineer",
    "education": null,
    "relationship": null,
    "source_db": "egypt"
  }
}
```

**لا يحتاج migration** — الحقل موجود بالفعل.

---

## بنية ملفات SQLite الخارجية (للقراءة فقط)

### جدول `data` في كل ملف `.db`

| العمود | النوع | يُستخدم في الإثراء؟ |
|--------|------|---------------------|
| `id` | INTEGER PK | ❌ |
| `FBID` | VARCHAR(255) | ✅ **مفتاح المطابقة** |
| `Phone` | VARCHAR(255) | ✅ |
| `first_name` | VARCHAR(255) | ✅ |
| `last_name` | VARCHAR(255) | ✅ |
| `email` | VARCHAR(255) | ✅ |
| `birthday` | VARCHAR(255) | ❌ (قيمة محدودة) |
| `birthdayYear` | VARCHAR(255) | ❌ |
| `gender` | VARCHAR(255) | ✅ |
| `locale` | VARCHAR(255) | ❌ |
| `hometown` | VARCHAR(255) | ✅ |
| `location` | VARCHAR(255) | ✅ |
| `country` | VARCHAR(255) | ❌ |
| `work` | TEXT | ✅ |
| `education` | TEXT | ❌ (غالباً فارغ) |
| `relationship` | TEXT | ❌ |
| `religion` | TEXT | ❌ |
| `about_me` | TEXT | ❌ |

**ملاحظة**: الأعمدة غير المُستخدمة في الإثراء (birthday, locale, country, religion, about_me) تُستبعد لتوفير المساحة في JSON. يمكن إضافتها مستقبلاً بسهولة.

---

## الفهرس الموجود

```sql
CREATE INDEX DataIndex ON data (FBID, Phone);
```

هذا الفهرس يكفي لـ `WHERE FBID IN (...)` — لا حاجة لإنشاء فهارس جديدة.

---

## ملفات قاعدة البيانات المتاحة

| الملف | الحجم | البلد | ملاحظات |
|-------|-------|-------|---------|
| `egypt.db` | ~13 GB | مصر | تالف جزئياً؛ الاستعلامات المفهرسة تعمل |
| `Iraq.db` | ~1.2 GB | العراق | نظيف لكن بعض FBIDs بها BOM prefix |

**المسار**: `extraction-service/db/` (قابل للتخصيص عبر `ENRICHMENT_DB_PATH`)

---

## تدفق البيانات

```
1. استخراج Facebook → extraction_results (fb_id, data, metadata={})
2. إثراء تلقائي:
   a. جلب fb_ids من extraction_results للمهمة
   b. بحث في SQLite: SELECT ... WHERE FBID IN (...)
   c. بناء Map<fb_id, enrichment_data>
   d. تحديث extraction_results.metadata = { enrichment: {...} }
3. تصدير/عرض → بيانات أصلية + بيانات إثراة
```

---

## إحصائيات الإثراء

تُحفظ في `extraction_jobs.progress` (حقل موجود بالفعل):

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
