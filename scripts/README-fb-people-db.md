# قاعدة بيانات الإثراء (مصر + العراق)

استيراد ملفي `egypt.db` و `Iraq.db` إلى جدول `public.fb_people_db` داخل Lovable Cloud،
ثم بناء فهرس البحث الذكي للأسماء بعد الانتهاء.

> **مهم**: الاستيراد يتم لمرة واحدة فقط. شغّله من VPS لأن حجم البيانات ~14GB.
> ميزة الإثراء داخل الموقع تشتغل تلقائياً فور الانتهاء.

## 0) المتطلبات

داخل مجلد المشروع على الـ VPS:

```bash
cd /home/khaled/flowtix
npm i -D better-sqlite3 pg pg-copy-streams
```

ثم احصل على رابط قاعدة بيانات Postgres من Lovable (الـ DATABASE_URL الكامل بصيغة
`postgres://postgres.xxxx:PASSWORD@aws-0-...pooler.supabase.com:5432/postgres?sslmode=require`).
ضعه في متغير بيئة:

```bash
export DATABASE_URL="postgres://...?sslmode=require"
```

## 1) ضع ملفات البيانات

ضع `egypt.db` و `Iraq.db` في مكان قابل للقراءة، مثلاً `/data/superdata/`.

## 2) استيراد مصر (45 مليون صف، 30-60 دقيقة)

```bash
node scripts/etl-fb-people-db.mjs --country=EG --sqlite=/data/superdata/egypt.db
```

النتيجة المتوقعة: شريط تقدّم يعرض النسبة، السرعة، عدد الصفوف المدرجة فعلياً.
الصفحات الفاسدة في `egypt.db` يتم تخطّيها تلقائياً بنظام التقسيم (Binary Halving)
دون توقف الاستيراد، وستظهر سطور `[skip] id=...` نادرة في السجل.

## 3) استيراد العراق (12 مليون صف، 8-15 دقيقة)

```bash
node scripts/etl-fb-people-db.mjs --country=IQ --sqlite=/data/superdata/Iraq.db
```

## 4) بناء فهرس البحث الذكي للأسماء (مرة واحدة بعد الانتهاء)

```bash
node scripts/etl-fb-people-db.mjs --post-index
```

يبني فهرس `GIN trigram` على عمود الاسم المُطبَّع (لتمكين البحث الذكي بالأسماء العربية).
يستغرق 5-30 دقيقة، وبعدها الإثراء يصبح فعّالاً 100%.

## خيارات إضافية

| Flag | الوصف |
|------|------|
| `--batch=10000` | حجم الدفعة (افتراضي 5000). |
| `--start=N` `--end=M` | لاستيراد نطاق محدد فقط (للاستئناف بعد انقطاع). |
| `--truncate` | يحذف بيانات الدولة المختارة من Postgres قبل البدء (لإعادة الاستيراد من الصفر). |

## استئناف بعد انقطاع

السكربت يطبع `id=...` لكل دفعة. لو توقف عند `id=8500000`، أعد التشغيل بـ:

```bash
node scripts/etl-fb-people-db.mjs --country=EG --sqlite=/data/superdata/egypt.db --start=8500001
```

الإدخال محمي بـ `ON CONFLICT (country, phone_norm) DO NOTHING` فلن يحدث تكرار.

## فحص النتيجة من داخل Lovable

افتح صفحة `الإثراء` (`/dashboard/enrich`)، الصق قائمة فيها FBID أو أرقام
أو أسماء عربية، واضغط **تحليل وإثراء**؛ النتائج تأتي من القاعدة الجديدة تلقائياً.
