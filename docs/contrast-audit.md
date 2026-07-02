# فحص تباين الألوان التلقائي (WCAG)

يشغّل `scripts/contrast-audit.mjs` قواعد axe-core `color-contrast` و
`color-contrast-enhanced` على قائمة من الصفحات في **الوضع الفاتح والداكن**
ويطبع تقريراً بأي عناصر لا تحقق نسبة التباين المطلوبة (AA/AAA).

## التشغيل

```bash
# محلياً — يستخدم http://localhost:8080 افتراضياً
bun run audit:contrast

# على البيئة المنشورة أو مسارات محددة
BASE_URL=https://flowtix-social-connect.lovable.app \
  bun run audit:contrast /dashboard /dashboard/whatsapp/inbox
```

- الخروج بكود `0` = لا توجد مشاكل، `1` = توجد مخالفات.
- تقرير JSON مفصّل يُحفظ في `/tmp/contrast-report.json`.
- الصفحات المحمية التي تحوّل إلى `/auth` تُشار في التقرير بـ `auth-gated`
  وتُفحص صفحة الدخول بدلاً منها.

## المسارات الافتراضية

`/`, `/auth`, `/login`, `/pricing`, `/dashboard`, `/dashboard/whatsapp/inbox`,
`/dashboard/facebook/groups`, `/dashboard/facebook/campaigns/new`,
`/dashboard/bulk`, `/dashboard/jobs`.

مرّر مسارات كوسائط لتقييد الفحص:
```bash
bun run audit:contrast /dashboard/whatsapp/inbox
```

## كيف يبدّل الوضع الداكن

قبل كل زيارة، السكربت:
1. يضبط `localStorage.theme = "dark"` (نفس المفتاح الذي يستخدمه موفّر
   الثيم لدينا) عبر `addInitScript`.
2. يضيف صنف `.dark` على `<html>` مباشرةً بعد التحميل كضمان في حال لم
   يكن الـ hydration قد اكتمل.
3. يمرّر `colorScheme: "dark"` إلى Playwright لضبط `prefers-color-scheme`.

## دمجه في CI (اختياري)

أضف خطوة في GitHub Actions بعد `bun run build`:

```yaml
- run: bun run preview & npx wait-on http://localhost:3100
- run: BASE_URL=http://localhost:3100 bun run audit:contrast
```

فشل الفحص يوقف الـ pipeline، مما يمنع تسريب ألوان غير مقروءة إلى
الإنتاج — خاصةً في الوضع الليلي.
