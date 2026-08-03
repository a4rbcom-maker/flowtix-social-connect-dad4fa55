# Research: إثراء بيانات المستخدمين المستخرجة

**Feature**: 005-data-enrichment | **Date**: 2026-07-30

---

## R1: مكتبة الوصول لـ SQLite في Node.js

**القرار**: `better-sqlite3`

**السبب**:
- أسرع مكتبة SQLite لـ Node.js (synchronous API بدون promises overhead)
- تدعم قواعد بيانات كبيرة (13GB+) مع `readonly` mode
- تدعم prepared statements مع `IN` clauses
- لا تحتاج native build معقد (prebuilt binaries متوفرة)

**البدائل المُستبعدة**:
- `sqlite3` (async) — أبطأ، callback-based، أكثر تعقيداً
- `sql.js` (WASM) — يُحمّل كامل الملف في الذاكرة (13GB! — مستحيل)
- نسخ البيانات لـ PostgreSQL — يحتاج迁移 ضخم + مئات الملايين من السجلات

---

## R2: أين تُحفظ بيانات الإثراء؟

**القرار**: حقل `metadata` في جدول `extraction_results` (موجود حالياً وفارغ `{}`)

**السبب**:
- `metadata` حقل `jsonb` موجود بالفعل ويُستخدم كـ `{}`
- لا يحتاج migration جديد
- البيانات الأصلية (name, profile_url, avatar_url) محفوظة في `data` — لن تُمس
- بنية واضحة: `metadata.enrichment = { phone, first_name, last_name, ... }`

**شكل البيانات بعد الإثراء**:
```json
{
  "data": { "name": "أحمد محمد", "profile_url": "...", "avatar_url": "..." },
  "metadata": {
    "enrichment": {
      "phone": "201110598247",
      "first_name": "احمد",
      "last_name": "محمد",
      "email": null,
      "gender": "male",
      "hometown": "None.",
      "location": "None.",
      "work": "None",
      "source_db": "egypt"
    }
  }
}
```

**البدائل المُستبعدة**:
- حقل جديد `enrichment_data` — يحتاج migration + تحديث types
- جدول منفصل `enrichment_results` — يُعقّد الـ queries والـ export
- توسيع حقل `data` — يخلط بيانات الاستخراج الأصلية بالإثراء

---

## R3: كيفية تنفيذ البحث بـ batch

**القرار**: `SELECT ... WHERE FBID IN (?, ?, ...)` بـ batch size = 500

**السبب**:
- SQLite يتعامل مع `IN` clauses بكفاءة عالية مع الفهرس الموجود
- 500 قيمة في `IN` clause متوازنة بين الأداء وحد SQLite (الحد الأقصى 999 متغير)
- batch size 500 = ~0.5 ثانية لكل دفعة (500 × 1ms)
- إثراء 1000 مستخدم = دفعتين = ~1 ثانية

**آلية التنفيذ**:
1. جلب كل `fb_id` من `extraction_results` للمهمة
2. تقسيمهم لدفعات (500 لكل دفعة)
3. لكل دفعة: `SELECT FBID, Phone, ... FROM data WHERE FBID IN (...)`
4. بناء Map<FBID, EnrichmentRow>
5. تحديث `extraction_results.metadata` في Supabase بـ batch update

---

## R4: متى يُنفّذ الإثراء؟

**القرار**: تلقائياً بعد اكتمال الاستخراج (في `extract.ts` بعد `completed`)

**السبب**:
- المستخدم لا يحتاج لضغط أي زر — تلقائي بالكامل
- لا يؤثر على سرعة الاستخراج (يُنفذ بعده)
- إذا فشل الإثراء، النتائج الأصلية محفوظة بالفعل

**مكان الاستدعاء**: في `runExtractionJob()` في `extract.ts`، بعد أن يكتمل الـ extractor بنجاح (status = `completed`)، يُستدعى `enrichmentService.enrichJobResults(jobId)`

---

## R5: التعامل مع BOM prefix في Iraq.db

**القرار**: تنظيف BOM عند قراءة النتائج من SQLite (وليس تعديل الملف)

**السبب**:
- الملفات للقراءة فقط
- BOM = `\uFEFF` (U+FEFF) في بداية بعض الـ FBIDs
- تنظيف عند قراءة النتائج: `fbid.replace(/^\uFEFF/, '')`
- أيضاً تنظيف `msg_` prefix من نتائج messenger_contacts

---

## R6: التعامل مع قاعدة البيانات التالفة

**القرار**: try/catch حول كل عملية SQLite، مع تسجيل الخطأ والمتابعة

**السبب**:
- `egypt.db` تالف جزئياً — بعض الاستعلامات تعمل وأخرى لا
- البحث المفهرس بـ FBID يعمل (1ms) لكن COUNT يفشل
- إذا فشلت دفعة ما، ننتقل للدفعة التالية بدلاً من إيقاف كل شيء

**آلية**: wrap كل `db.prepare().all()` في try/catch، إذا فشلت دفعة سجّل الخطأ وحاول الدفعة التالية بـ batch أصغر (50 بدلاً من 500)

---

## R7: إبقاء اتصال SQLite مفتوح أم فتح/إغلاق لكل عملية؟

**القرار**: فتح اتصال لكل عملية إثراء ثم إغلاقه

**السبب**:
- ملفات SQLite كبيرة (13GB) — لا نريد إبقاؤها مفتوحة في الذاكرة طوال وقت تشغيل الخادم
- الإثراء يحدث مرة واحدة لكل مهمة استخراج
- `better-sqlite3` يفتح الملف سريعاً مع readonly mode
- تجنب مشاكل file locking مع عمليات أخرى

---

## R8: موقع ملفات قاعدة البيانات

**القرار**: مجلد `extraction-service/db/` — مع إعدادات قابلة للتخصيص عبر متغير بيئة

**السبب**:
- ملفات `.db` كبيرة — لا يجب أن تكون في git
- المتغير `ENRICHMENT_DB_PATH` يُحدد المجلد (default: `./db`)
- عند النشر، يُنسخ الملفات يدوياً أو عبر script

---

## R9: توسيع التصدير ليشمل بيانات الإثراء

**القرار**: إذا وُجد `metadata.enrichment` في السجل، أضف أعمدة الإثراء لـ CSV/JSON

**شكل CSV بعد الإثراء**:
```
id,name,profile_url,avatar_url,phone,first_name,last_name,gender,hometown,location,work,email
```

**شكل JSON بعد الإثراء**:
```json
{ "id": "...", "name": "...", "enrichment": { "phone": "...", ... } }
```
