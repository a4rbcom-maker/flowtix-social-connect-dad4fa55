export function renderErrorPage() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Flowtix Tools — خطأ مؤقت</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf8ff;color:#1b1428;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      main{width:min(92vw,560px);padding:40px 28px;text-align:center}
      h1{margin:0 0 12px;font-size:28px;line-height:1.25}
      p{margin:0 0 24px;color:#594a6d;line-height:1.8}
      .actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
      a,button{border:0;border-radius:10px;padding:12px 18px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none}
      button{background:#8b3ff6;color:white}
      a{background:#eee8fb;color:#2c164b}
    </style>
  </head>
  <body>
    <main>
      <h1>حدث خطأ مؤقت</h1>
      <p>تم تسجيل الخطأ تلقائيًا. جرّب تحديث الصفحة أو العودة للرئيسية.</p>
      <div class="actions">
        <button onclick="location.reload()">تحديث الصفحة</button>
        <a href="/">الرئيسية</a>
      </div>
    </main>
  </body>
</html>`;
}