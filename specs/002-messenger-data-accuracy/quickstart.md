# Quickstart: دقة بيانات جهات ماسنجر

**تاريخ**: 2026-07-29

---

## المتطلبات

1. خدمة الاستخراج شغالة: `http://localhost:3100/health` → `{ status: "ok" }`
2. جلسة فيسبوك صالحة (متاحة في الداشبورد)
3. صفحة `manfaz.alnasr` (أو أي صفحة متاحة)

---

## سيناريوهات التحقق

### السيناريو 1: بدون صفحات — نتحقق إن مفيش صفحات في النتائج

**الهدف**: التأكد إن النتائج فيها مستخدمين فقط، لا صفحات ولا مؤسسات.

1. شغل استخراج جديد:
   ```powershell
   $body = @{ session_id = "109ad6c5-0612-485a-8735-ca48e94e32e2"; type = "messenger_contacts"; source_url = "manfaz.alnasr" } | ConvertTo-Json
   $r = Invoke-RestMethod -Uri "http://localhost:3100/extract" -Method POST -ContentType "application/json" -Headers @{"x-api-key"="flowtix-extraction-2026"} -Body $body
   $jobId = $r.job_id
   ```

2. بعد انتهاء المهمة (تستغرق ~8 دقائق)، افحص النتائج:
   ```powershell
   node -e "
   const { createClient } = require('@supabase/supabase-js');
   const sb = createClient('https://ukjrizflmkutadsrcmut.supabase.co', 'sb_secret_rptw3rPZ4xpbfYavBA5snA_KFXa9MdP');
   (async () => {
     const { data } = await sb.from('extraction_results')
       .select('data').eq('job_id', '$jobId');
     const suspicious = data.filter(r => {
       const n = (r.data?.name || '').toLowerCase();
       return n.includes('news') || n.includes('store') || n.includes('school')
         || n.includes('shop') || n.includes('university') || n.includes('restaurant')
         || n.includes('cafe') || n.includes('airline') || n.includes('entertainment')
         || n.includes('recruiting') || n.includes('business');
     });
     console.log('Total:', data.length, 'Suspicious (pages/etc):', suspicious.length);
     if (suspicious.length > 0) console.log('  ', suspicious.map(r=>r.data?.name));
     else console.log('✅ ZERO pages - all looks like real people!');
   })();
   "
   ```

3. **النتيجة المتوقعة**: `Suspicious: 0` — مفيش صفحات في النتائج.

### السيناريو 2: بدون أسماء مولّدة أوتوماتيكياً

**الهدف**: التأكد إن مفيش "AdventurousRaccoon", "ShinyCapybara" إلخ.

1. نفس الخطوات في السيناريو 1، لكن الفحص مختلف:
   ```powershell
   node -e "
   const { createClient } = require('@supabase/supabase-js');
   const sb = createClient('https://ukjrizflmkutadsrcmut.supabase.co', 'sb_secret_rptw3rPZ4xpbfYavBA5snA_KFXa9MdP');
   (async () => {
     const { data } = await sb.from('extraction_results')
       .select('data').eq('job_id', '$jobId');
     const autoGen = data.filter(r => {
       const n = r.data?.name || '';
       return /^(Adventurous|Playful|Shiny|Happy|Sleepy|Crazy|Funny|Silly|Cool|Super)\w+\d+$/.test(n)
         || n === 'WA Not Available';
     });
     console.log('Auto-generated:', autoGen.length);
     if (autoGen.length === 0) console.log('✅ No auto-generated names');
   })();
   "
   ```

2. **النتيجة المتوقعة**: `Auto-generated: 0`

### السيناريو 3: بدون تكرار (صفحة نفسها أو مديرها)

**الهدف**: التأكد إن الصفحة نفسها وأسماء الإداريين مش في النتائج.

```powershell
node -e "
const { createClient } = require('@supabase/supabase-js');
const sb = createClient('https://ukjrizflmkutadsrcmut.supabase.co', 'sb_secret_rptw3rPZ4xpbfYavBA5snA_KFXa9MdP');
(async () => {
  const { data } = await sb.from('extraction_results')
    .select('data').eq('job_id', '$jobId');
  const pageNames = data.filter(r => (r.data?.name || '') === 'منفذ النصر');
  console.log('Page name in results:', pageNames.length > 0 ? '❌ FAIL' : '✅ PASS');
})();
"
```

### السيناريو 4: دقة إجمالية

**الهدف**: قياس الدقة الإجمالية — نسبة الـ contacts الحقيقيين من الإجمالي.

```powershell
node -e "
const { createClient } = require('@supabase/supabase-js');
const sb = createClient('https://ukjrizflmkutadsrcmut.supabase.co', 'sb_secret_rptw3rPZ4xpbfYavBA5snA_KFXa9MdP');
(async () => {
  const { data } = await sb.from('extraction_results')
    .select('data').eq('job_id', '$jobId');
  
  const bad = data.filter(r => {
    const n = (r.data?.name || '').toLowerCase();
    const autoGen = /^(adventurous|playful|shiny|happy|sleepy|crazy|funny|silly|cool|super)\w+\d+$/.test(n);
    const pageKeyword = /news|store|school|university|restaurant|cafe|airline|entertainment|recruiting|foundation|magazine/.test(n);
    const missing = n === 'wa not available';
    const selfRef = n === 'منفذ النصر';
    return autoGen || pageKeyword || missing || selfRef;
  });
  
  const pct = ((data.length - bad.length) / data.length * 100).toFixed(1);
  console.log('Total:', data.length);
  console.log('Bad entries:', bad.length);
  console.log('Good entries:', data.length - bad.length);
  console.log('Accuracy:', pct + '%');
  if (parseFloat(pct) >= 90) console.log('✅ PASS (>= 90%)');
  else console.log('❌ FAIL (< 90%)');
})();
"
```

### السيناريو 5: الاستقرار (تشغيلين متتاليين)

**الهدف**: التأكد إن عدد النتائج ثابت ±5%.

1. شغل الاستخراج مرتين متتاليتين
2. سجل النتيجة لكل مرة
3. نسبة الاختلاف: `|result1 - result2| / max(result1, result2) * 100`
4. **النتيجة المتوقعة**: الاختلاف ≤ 5%

---

## استكشاف الأخطاء

| المشكلة | السبب المحتمل | الحل |
|---------|---------------|------|
| تحصيل 0 جهة | الفلتر جديد جداً — حظر كل الـ responses | راجع لوج الـ MessengerContacts عشان تعرف الـ responses اللي اتحظرة |
| لسه في صفحات | الفلتر مش قوي كفاية | زيد الكلمات الممنوعة في keyword exclusion |
| الجلسة disconnected | انتهت صلاحية الجلسة | أعد تسجيل الدخول من صفحة الجلسات |