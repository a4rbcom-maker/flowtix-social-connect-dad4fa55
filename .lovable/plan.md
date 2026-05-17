## السبب الفعلي

من اللوج (الصورة الثانية):
```
ERROR: bun is required on the server for production install (npm path disabled).
Install bun with: curl -fsSL https://bun.sh/install | bash
```

الـ workflow بيفترض إن `bun` متثبت على الـ VPS، ولما مايلاقيهوش بيقتل النشر فورًا. وبعدها الـ Auto rollback بيفشل لأن أقرب snapshot قديم مش متوافق مع شكل الـ SSR الحالي (`is_valid_ssr_snapshot` بيرفضه).

دي مش مشكلة كود، دي مشكلة bootstrap على السيرفر.

## الحل النهائي (خطوتين فقط في `.github/workflows/deploy.yml`)

### 1) Auto-bootstrap Bun على الـ VPS

في خطوة **Install dependencies and restart SSR app**، بدّل الـ block اللي بيعمل `exit 1` لما `bun` مش موجود بـ installer غير تفاعلي:

```bash
if ! command -v bun >/dev/null 2>&1; then
  echo "Bun not found on server — installing automatically…"
  export BUN_INSTALL="$HOME/.bun"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$BUN_INSTALL/bin:$PATH"
  # ثبّت في PATH للجلسات الجاية
  grep -q 'BUN_INSTALL' "$HOME/.bashrc" 2>/dev/null || {
    echo 'export BUN_INSTALL="$HOME/.bun"' >> "$HOME/.bashrc"
    echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> "$HOME/.bashrc"
  }
fi
# تأكيد نهائي
command -v bun >/dev/null 2>&1 || { echo "ERROR: bun install failed"; exit 1; }
echo "Bun version on server: $(bun --version)"
```

كده أول نشر هيثبّت Bun لوحده، وكل نشر بعديه هيلاقيه جاهز.

### 2) تقوية الـ rollback لما مفيش snapshot متوافق

حاليًا لو الـ snapshots القديمة مش بتطابق شكل SSR الجديد، الـ rollback بيطبع `ROLLBACK_RESULT=no_valid_ssr_snapshot` وبيخرج 0، لكن الخطوة نفسها بترجع exit 1 من مكان تاني (السطر 183 في الصورة الأولى).

نخلي الـ rollback يعمل حاجة مفيدة لما مفيش snapshot:
- لو السيرفر شغّال أصلًا (PM2 process حي وبيرد على البورت)، نسيب الموقع زي ما هو ونخرج success بـ warning.
- لو لأ، نخرج بـ warning واضح إن المطلوب نشر يدوي.

ودا بيمنع تحويل فشل النشر الأول لـ rollback failure مضلل.

## ما لن أفعله

- مش هغير منطق التطبيق ولا الـ routes ولا أي ملفات Supabase.
- مش هرجع لـ npm.
- مش هلمس الـ snapshots القديمة على السيرفر.

## النتيجة المتوقعة

- النشر القادم: Bun هيتثبّت تلقائيًا، الـ `bun install --production --frozen-lockfile` هينجح، PM2 هيقوم بنسخة `flowtixtools-web`، والـ `/deploy-version.json` هيعرض الـ SHA الجديد.
- لو في أي خطوة بعد كده فشلت، الـ rollback هيدّي رسالة واضحة بدل ما يفشل بدون توضيح.
