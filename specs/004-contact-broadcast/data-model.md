# Data Model: مراسلة جهات الاتصال المستخرجة

**Feature**: 004-contact-broadcast | **Date**: 2026-07-30

---

## الجداول الجديدة

### 1. `broadcast_jobs`

تمثّل مهمة إرسال جماعي واحدة.

| العمود | النوع | القيد | الوصف |
|--------|------|-------|-------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | معرّف فريد |
| `extraction_job_id` | `uuid` | FK → `extraction_jobs.id`, NOT NULL | مهمة الاستخراج المرتبطة |
| `session_id` | `uuid` | FK → `fb_sessions.id`, NOT NULL | جلسة Facebook المستخدمة للإرسال |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users.id` | صاحب المهمة (لـ RLS) |
| `name` | `text` | NOT NULL | اسم المهمة (يُولّد تلقائياً) |
| `status` | `text` | NOT NULL, default `'queued'` | الحالة: `queued` → `running` → `completed` \| `failed` \| `canceled` |
| `message` | `text` | NOT NULL | نص الرسالة (قد يحتوي `{{name}}`) |
| `media_storage_key` | `text` | nullable | مفتاح الصورة المرفقة في Supabase Storage |
| `media_filename` | `text` | nullable | اسم الملف الأصلي |
| `total_recipients` | `integer` | NOT NULL, default `0` | إجمالي المستلمين |
| `sent_count` | `integer` | NOT NULL, default `0` | عدد الناجح |
| `failed_count` | `integer` | NOT NULL, default `0` | عدد الفاشل |
| `progress` | `jsonb` | default `'{}'` | `{ current_idx, current_name, current_fb_id, percent }` |
| `started_at` | `timestamptz` | nullable | وقت بدء الإرسال |
| `completed_at` | `timestamptz` | nullable | وقت اكتمال/إيقاف |
| `error` | `text` | nullable | رسالة خطأ عامة (إن وجدت) |
| `created_at` | `timestamptz` | default `now()` | وقت الإنشاء |
| `updated_at` | `timestamptz` | default `now()` | آخر تحديث |

**Indexes**:
- `idx_broadcast_jobs_user_id` ON (`user_id`)
- `idx_broadcast_jobs_session_id` ON (`session_id`)
- `idx_broadcast_jobs_extraction_job_id` ON (`extraction_job_id`)
- `idx_broadcast_jobs_status` ON (`status`)

**RLS Policies** (نفس نمط extraction_jobs):
```sql
CREATE POLICY "select_own_broadcast_jobs" ON broadcast_jobs FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY "insert_own_broadcast_jobs" ON broadcast_jobs FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "update_own_broadcast_jobs" ON broadcast_jobs FOR UPDATE USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY "delete_own_broadcast_jobs" ON broadcast_jobs FOR DELETE USING (user_id = auth.uid() OR is_super_admin());
```

---

### 2. `broadcast_recipients`

سجل لكل مستلم في كل مهمة بث.

| العمود | النوع | القيد | الوصف |
|--------|------|-------|-------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | معرّف فريد |
| `broadcast_job_id` | `uuid` | FK → `broadcast_jobs.id` ON DELETE CASCADE, NOT NULL | المهمة المرتبطة |
| `user_id` | `uuid` | NOT NULL | صاحب المهمة (لـ RLS، مُكرّر من الجدول الأب لتبسيط queries) |
| `fb_id` | `text` | NOT NULL | Facebook user ID نظيف (بدون `msg_` prefix) |
| `name` | `text` | nullable | اسم جهة الاتصال (لاستبدال `{{name}}`) |
| `profile_url` | `text` | nullable | رابط الملف الشخصي |
| `status` | `text` | NOT NULL, default `'pending'` | `pending` → `sent` \| `failed` |
| `error_message` | `text` | nullable | رسالة الخطأ (عند الفشل) |
| `attempted_at` | `timestamptz` | nullable | وقت محاولة الإرسال |
| `created_at` | `timestamptz` | default `now()` | وقت الإنشاء |

**Indexes**:
- `idx_broadcast_recipients_job_id` ON (`broadcast_job_id`)
- `idx_broadcast_recipients_status` ON (`broadcast_job_id`, `status`)
- `idx_broadcast_recipients_user_id` ON (`user_id`)

**RLS Policies**:
```sql
CREATE POLICY "select_own_broadcast_recipients" ON broadcast_recipients FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY "insert_own_broadcast_recipients" ON broadcast_recipients FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "update_own_broadcast_recipients" ON broadcast_recipients FOR UPDATE USING (user_id = auth.uid() OR is_super_admin());
```

---

## State Transitions

### `broadcast_jobs.status`

```
queued ──→ running ──→ completed
              │    ──→ failed
              │    ──→ canceled
```

- `queued`: أُنشئت المهمة، بانتظار بدء الـ worker
- `running`: الـ worker يعمل، يرسل الرسائل
- `completed`: كل المستلمين عُولجوا (sent أو failed)
- `failed`: خطأ عام (جلسة غير متصلة، browser crash)
- `canceled`: المستخدم أوقف الإرسال (النتائج الجزئية محفوظة)

### `broadcast_recipients.status`

```
pending ──→ sent
         ──→ failed
```

---

## Relations

```
extraction_jobs (1) ──→ (N) extraction_results
        │
        └── (1) ──→ (N) broadcast_jobs
                           │
                           └── (1) ──→ (N) broadcast_recipients

fb_sessions (1) ──→ (N) broadcast_jobs
```

---

## Storage

### Bucket: `broadcast-media`

| الإعداد | القيمة |
|---------|--------|
| Access | Private (signed URLs only) |
| Allowed MIME | `image/jpeg`, `image/png` |
| Max file size | 5 MB |
| Path pattern | `{user_id}/{broadcast_job_id}/{filename}` |

**RLS (Storage)**:
```sql
CREATE POLICY "upload_own_broadcast_media" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'broadcast-media' AND auth.uid() = (storage.foldername(name))[1]::uuid);
CREATE POLICY "read_own_broadcast_media" ON storage.objects FOR SELECT USING (bucket_id = 'broadcast-media' AND auth.uid() = (storage.foldername(name))[1]::uuid);
```
