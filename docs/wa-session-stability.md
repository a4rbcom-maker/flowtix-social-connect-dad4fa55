# فحص استقرار جلسة واتساب (Session Stability Check)

هذا الملف يوثّق الضمانات المُلزَمة برمجيًا وطريقة التحقق منها يدويًا.

## الضمانات (Invariants)

جلسة واتساب **لا** يجب أن تُعلَّم كـ `disconnected` إلا عند:
1. تسجيل خروج فعلي من الجوال (فصل الجهاز المرتبط).
2. حدث ويب هوك موثوق يتضمن `logged_out` / `device_removed` / `unlinked`.
3. حدث ويب هوك يتضمن `401 unauthorized` + `closed/logout`.
4. طلب فصل يدوي من المستخدم داخل التطبيق (`source = "disconnect"`).

يجب **تجاهل** كل ما يلي (تبقى الجلسة connected):
- أحداث ويب هوك متأخرة (`eventAt` أقدم من `last_seen_at` بأكثر من ثانيتين).
- انقطاعات عابرة (`socket closed`, `timeout`, `reconnecting`, `restart_required`).
- أي `disconnected` غير موثوق يصل أثناء وجود حملة إرسال جماعي `running`/`scheduled` لنفس المستخدم.
- إرسال أو استقبال رسائل (يحدث فقط `last_seen_at`).

## الاختبار التلقائي

المرجع: `src/lib/wa-session-stability.test.ts` — 9 اختبارات تُنفَّذ عبر:

```bash
bunx vitest run src/lib/wa-session-stability.test.ts
```

يجب أن ينجح **الـ 9 اختبارات** قبل أي نشر يمس منطق الجلسة.

## الفحص اليدوي السريع

1. اربط واتساب من `/dashboard/accounts` وتأكد من `connected`.
2. أرسل رسالة اختبار من صفحة الحسابات → يجب أن يبقى المؤشر أخضر.
3. شغّل حملة `bulk` صغيرة (5-10 مستلمين) وراقب `wa_sessions.status` في السجل — لا يجب أن يتغير.
4. في `wa_session_events` أي محاولة فصل مكذوبة تظهر بسبب واضح: `ignored_transient_disconnect(late_event | bulk_active_debounce | untrusted_disconnect)`.
5. من الجوال: أزل الجهاز المرتبط → يجب أن يتحول الحالة إلى `disconnected` خلال ثوانٍ وتُسجَّل الحادثة بمصدر `webhook_status` وسبب يحتوي `logged_out` أو `401`.

## استعلام تدقيق سريع

```sql
select created_at, from_status, to_status, source, reason
from wa_session_events
where user_id = '<UID>'
order by created_at desc
limit 50;
```

أي صف يحمل `to_status = 'disconnected'` بدون سبب موثوق = خطأ يجب فحصه.
