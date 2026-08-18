# Contracts: واجهات extraction-service لإنستجرام

**المرجع**: [spec.md](./spec.md) FR-001..FR-017 + [data-model.md](./data-model.md)

كل المسارات محمية بـ `X-API-Key: flowtix-extraction-2026` (نفس middleware القائم) وتقبل/تعيد JSON.

## 1. POST /ig/session-check

فحص صلاحية جلسة إنستجرام المخزنة (يفتح instagram.com بكوكيزها).

**Request**:

```json
{ "session_id": "uuid" }
```

**Response 200**:

```json
{
  "session_id": "uuid",
  "status": "connected",
  "auth_state": "authenticated",
  "ig_username": "example.user",
  "avatar_url": "https://..."
}
```

**أخطاء**: 404 `SESSION_NOT_FOUND` | 410 `SESSION_NOT_CONNECTED` (حالة disconnected) | 500 `SESSION_EXPIRED` (كوكيز مرفوضة — يعلم الجلسة disconnected)

## 2. POST /ig/sessions/import

استيراد/تحديث كوكيز جلسة (يتولى الواجهة القراءة من متصفح المستخدم).

**Request**:

```json
{
  "user_id": "uuid",
  "name": "جلسة إنستجرام 1",
  "cookies": [ { "name": "sessionid", "value": "...", "domain": ".instagram.com", "...": "..." } ]
}
```

**Response 200**: `{ "session_id": "uuid", "status": "connected", "ig_username": "..." }` — يعيد فحصاً فورياً؛ كوكيز بلا `sessionid`/`ds_user_id`/`csrftoken` → 400 `INVALID_COOKIES`.

## 3. POST /extract — توسيع العقد القائم

نفس عقد `/extract` الحالي تماماً مع قيم type الجديدة:

```
type ∈ ig_followers | ig_following | ig_post_commenters | ig_hashtag_posts | ig_profile_info
source_url:
  - ig_followers/ig_following: "https://instagram.com/{username}"
  - ig_post_commenters: "https://instagram.com/p/{code}" | "/reel/{code}" | "/tv/{code}"
  - ig_hashtag_posts: "{hashtag}" (بدون #)
  - ig_profile_info: "{username}" أو "{username1,username2,...}" أو ملف نصي usernames
```

**Request** (متعدد الجلسات — ملاحظة المستخدم، R6):

```json
{
  "session_ids": ["uuid-1", "uuid-2"],
  "type": "ig_followers",
  "source_url": "https://instagram.com/target.account",
  "max_results": 8000,
  "skip_duplicates": true,
  "job_name": "متابعو المنافس X"
}
```

`session_id` المفرد يبقى مقبولاً (توافق خلفي مع fb).

**Response 202**: `{ "job_id": "uuid", "status": "queued" }` — تظهر المهمة في صفحة المهام خلال ≤ 5 ثوانٍ (SC-003).

## 4. GET /jobs/{id} + POST /jobs/{id}/cancel — كما هي

لا تغيير — نفس عقد fb (الحالة، progress مع `coverage` للمتابعين، النتائج، الإيقاف ب حفظ جزئي).

## 5. GET /export/{job_id} — كما هي مع عمودين جديدين

ملف Excel/CSV لنتائج IG يحمل إضافة إلى الأعمدة القائمة:

- `Platform` (instagram)
- `Match Confidence` (confirmed / probable / فارغ إن لم يُثارَ)
- `Bio Email`, `Bio Phone` (ig_profile_info)

## 6. عقد الواجهة الأمامية (frontend)

| المكوّن | السلوك المتعاقد |
| --- | --- |
| `IgSessionsPage` | قائمة جلسات IG (connected/disconnected + اسم الحساب والصورة)، استيراد كوكيز، فحص، حذف soft — معزولة تماماً عن قائمة fb |
| `ExtractIgPage` | اختيار نوع من الأربعة فقط (لا خيار مستحيل — FR-011)، اختيار جلسة/جلسات متعددة، ceiling، skip_duplicates |
| صفحة الجهات (Contacts) | فلتر منصة جديد (الكل/facebook/instagram) — لا أي مزج تلقائي |
| صفحة المهام | لا تغيير — مهام IG تظهر بنفس البطاقات مع أيقونة منصة |
| i18n | كل نص جديد في `ar.json` و`en.json` إلزامياً (RTL first) |

## 7. عقد الإثراء (داخلي)

بعد اكتمال أي مهمة ig_*: خلال ≤ 30 ثانية تبدأ مرحلة إثراء (SC-009) تكتب `metadata.enrichment` + `metadata.match_confidence` + `metadata.match_method` وفق R5 — بدون أي حذف أو تعديل لنتائج fb القائمة.
