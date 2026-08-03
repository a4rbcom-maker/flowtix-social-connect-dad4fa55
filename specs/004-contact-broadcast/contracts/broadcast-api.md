# API Contract: Broadcast Endpoints

**Feature**: 004-contact-broadcast | **Service**: extraction-service (port 3100)

جميع الـ endpoints تتطلب header: `X-API-Key: flowtix-extraction-2026`

---

## 1. POST `/broadcast/start`

بدء مهمة إرسال جماعي جديدة.

### Request Body

```json
{
  "extraction_job_id": "uuid",
  "session_id": "uuid",
  "message": "نص الرسالة مع {{name}} اختياري",
  "media_storage_key": "uuid/uuid/photo.jpg"  // optional, null = no image
}
```

### Validation (Zod)

| Field | Type | Rules |
|-------|------|-------|
| `extraction_job_id` | `string` | `min(1)` |
| `session_id` | `string` | `min(1)` |
| `message` | `string` | `min(1)`, `max(5000)` |
| `media_storage_key` | `string?` | optional |

### Response — 200 (Success)

```json
{
  "job_id": "uuid",
  "status": "queued",
  "total_recipients": 87
}
```

### Response — 409 (Active broadcast exists)

```json
{
  "error": {
    "code": "JOB_ALREADY_ACTIVE",
    "message": "يوجد مهمة إرسال نشطة بالفعل لهذه الجلسة"
  }
}
```

### Response — 400 (Session not connected)

```json
{
  "error": {
    "code": "SESSION_NOT_CONNECTED",
    "message": "الجلسة غير متصلة"
  }
}
```

### Response — 404 (No contacts)

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "لا توجد جهات اتصال للمراسلة في هذه المهمة"
  }
}
```

### Flow

1. تحقق من جلسة Facebook (متصل؟)
2. تحقق من عدم وجود مهمة بث نشطة لنفس الجلسة
3. اجلب نتائج الاستخراج (`extraction_results` حيث `job_id = extraction_job_id`)
4. فلتر الجهات بـ `fb_id` غير فار (استبعد null)
5. أنشئ `broadcast_jobs` row (status=`queued`)
6. أنشئ `broadcast_recipients` rows (status=`pending`) لكل جهة
7. شغّل `broadcast-worker` (async)
8. أرجع `job_id`

---

## 2. POST `/broadcast/stop`

إيقاف مهمة إرسال جارية.

### Request Body

```json
{
  "job_id": "uuid"
}
```

### Response — 200

```json
{
  "status": "canceled",
  "sent": 30,
  "failed": 5,
  "remaining": 65
}
```

### Flow

1. اقرأ الحالة الحالية — إذا ليست `running`، أرجع الخطأ
2. أوقف الـ worker (`stopBroadcastWorker`)
3. حدّث `broadcast_jobs.status = 'canceled'` + `completed_at = now()`
4. أحدث counts النهائية

---

## 3. GET `/broadcast/status/:jobId`

جلب الحالة الحالية لمهمة الإرسال (يُستدعى كل ثانيتين من الواجهة).

### Response — 200

```json
{
  "job_id": "uuid",
  "status": "running",
  "total": 87,
  "sent": 30,
  "failed": 5,
  "remaining": 52,
  "percent": 40,
  "current_name": "أحمد محمد",
  "started_at": "2026-07-30T10:00:00Z",
  "completed_at": null,
  "error": null
}
```

### Response — 404

```json
{
  "error": { "code": "NOT_FOUND", "message": "المهمة غير موجودة" }
}
```

### Flow

1. اقرأ `broadcast_jobs` row بالكامل
2. احسب `percent = Math.round((sent + failed) / total * 100)`
3. أرجع الحالة + counts + progress

---

## 4. GET `/broadcast/recipients/:jobId`

جلب قائمة المستلمين ونتائجهم (للعرض في شاشة الملخّص).

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | `string?` | all | Filter: `sent`, `failed`, `pending` |
| `limit` | `number` | 50 | Max results |
| `offset` | `number` | 0 | Pagination offset |

### Response — 200

```json
{
  "recipients": [
    {
      "fb_id": "123456789",
      "name": "أحمد محمد",
      "status": "sent",
      "error_message": null,
      "attempted_at": "2026-07-30T10:05:30Z"
    },
    {
      "fb_id": "987654321",
      "name": "فاطمة علي",
      "status": "failed",
      "error_message": "Chat page did not load",
      "attempted_at": "2026-07-30T10:06:45Z"
    }
  ],
  "total": 87,
  "sent": 30,
  "failed": 5
}
```

---

## WebSocket / Realtime

لا يوجد. التحديث يتم عبر polling على `/broadcast/status/:jobId` كل ثانيتين.

---

## Rate Limiting (Backend Worker)

| الإعداد | القيمة | الوصف |
|---------|--------|-------|
| `delay_min` | 60 ثانية | أقل تأخير بين الرسائل |
| `delay_max` | 180 ثانية | أكبر تأخير بين الرسائل |
| `max_consecutive_errors` | 10 | إيقاف تلقائي عند 10 أخطاء متتالية |
| `page_load_timeout` | 25 ثانية | timeout لفتح المحادثة |
| `send_timeout` | 10 ثانية | timeout لكتابة وإرسال الرسالة |
| `backoff_delay` | 300 ثانية | تأخير عند اكتشاف rate limit من Facebook |
