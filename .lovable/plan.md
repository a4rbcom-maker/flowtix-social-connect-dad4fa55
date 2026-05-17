## فحص جديد: `${{ }}` داخل heredoc في `run:`

### المشكلة اللي بنرصدها

لو حطينا `${{ ... }}` جوّا heredoc (`<<'EOF' ... EOF`) داخل `run:` block، GitHub بيعمل substitution **قبل** ما الشل يشتغل — فالنص بيتحوّل لتعبير ضخم. ده اللي سبب خطأ `Exceeded max expression length 21000` اللي قابلناه قبل كده.

### الخطة

**1) توسيع `scripts/ci/check-expression-length.py`** (مش ملف جديد — نفس الأداة):

نضيف فحص ثاني يقرأ الـ workflow كـ YAML، يلف على كل `run:` block، يكتشف heredocs بـ regex، ويتحقق من:

| الشرط | السلوك |
|---|---|
| `${{ }}` موجود جوّا heredoc | ⚠️ تحذير + اقتراح نقل المنطق لسكربت خارجي (مع استثناء `<<-EOF` بدون quotes لو محتاج expansion مقصود) |
| طول الـ heredoc body > 4000 حرف **و** يحتوي على `${{ }}` | ❌ يفشل الـ commit (هو السيناريو الخطر فعلاً) |
| طول الـ heredoc body > 8000 حرف بدون `${{ }}` | ⚠️ تحذير فقط (آمن لكن يستحق التقسيم) |

**2) تشغيل ذاتي على نفسه:** الفحص يطبّق نفسه على `.github/workflows/deploy.yml` وأي workflow جديد.

**3) الـ workflow الموجود `lint-workflows.yml`** يستدعي نفس السكربت — مفيش حاجة جديدة تتضاف للـ CI.

### تفاصيل تقنية مختصرة

- نستخدم regex `<<-?\s*['"]?(\w+)['"]?` لتحديد بداية heredoc، ونتتبع الـ terminator اللي بنفس الـ indentation.
- نسجل النوع: `quoted` (`<<'EOF'`) vs `unquoted` (`<<EOF`). الـ unquoted فقط هو اللي شِل بيعمله variable expansion، لكن GitHub بيعمل `${{ }}` substitution في الاتنين — فبنفحص الاتنين.
- نطبع `::error file=...,line=...` بصيغة GitHub Actions annotations.

### نتيجة متوقعة على الكود الحالي

من الفحص السابق: أكبر `run:` block 6313 حرف. لو فيه `${{ }}` جوّاه هيرفع علم — لو مفيهوش هيعدّي. هنشوف النتيجة بعد التطبيق.

### Pre-commit hook؟

`pre-commit` على المساحة دي شغّال على CI runner فقط (مش local). الـ workflow `lint-workflows.yml` بيتفعّل على push و PR وده هو منع الـ commit الفعلي عبر branch protection (لو مفعّل). لو عاوز فحص local قبل الـ push كمان أضيف Git hook في `.husky/` — قول لو محتاج ده.
