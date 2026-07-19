// Diagnostic job: launches Chromium (with the current proxy args passed by
// index.js) and asks a public IP echo service what egress IP the browser is
// using. Returns that IP as a job result so the UI can render it directly —
// no terminal / curl needed.
//
// This action deliberately does NOT log into Facebook. Testing a proxy should
// never touch the user's real FB session (which could invalidate it).

async function runTestProxy({ page, job, report }) {
  const startedAt = Date.now();
  const targets = [
    { url: "https://api.ipify.org?format=json", parse: (t) => { try { return JSON.parse(t).ip; } catch { return null; } } },
    { url: "https://ifconfig.co/ip", parse: (t) => (t || "").trim() },
    { url: "https://ipv4.icanhazip.com/", parse: (t) => (t || "").trim() },
  ];

  await report({ status: "running", progress: 20 });

  let ip = null;
  let lastError = null;
  for (const target of targets) {
    try {
      const resp = await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 25_000 });
      const status = resp ? resp.status() : 0;
      const body = await page.evaluate(() => document.body ? document.body.innerText : "");
      if (status >= 200 && status < 400) {
        const candidate = target.parse(body);
        if (candidate && /^[0-9a-fA-F.:]{3,45}$/.test(candidate)) {
          ip = candidate;
          break;
        }
        lastError = `HTTP ${status} من ${target.url} لكن الرد غير مفهوم: ${body.slice(0, 120)}`;
      } else {
        lastError = `HTTP ${status} من ${target.url}`;
      }
    } catch (e) {
      lastError = `${target.url}: ${String(e.message || e)}`;
    }
    await report({ progress: 55 });
  }

  const elapsedMs = Date.now() - startedAt;
  const proxyEnabled = Boolean(job.payload?.proxyUrl || job.account?.proxyUrl);

  if (!ip) {
    await report({
      result: {
        target: "test-proxy",
        status: "failed",
        error: lastError || "لم نستطع قراءة IP الخروج",
        data: { kind: "proxy_test", ok: false, proxyEnabled, elapsedMs },
      },
    });
    await report({
      status: "failed",
      progress: 100,
      errorMessage: proxyEnabled
        ? `فشل الاتصال عبر البروكسي: ${lastError || "لا استجابة"}`
        : `فشل قراءة IP الخروج: ${lastError || "لا استجابة"}`,
    });
    return;
  }

  await report({
    result: {
      target: "test-proxy",
      status: "success",
      data: { kind: "proxy_test", ok: true, ip, proxyEnabled, elapsedMs },
    },
    processedItems: 1,
    totalItems: 1,
    progress: 100,
  });
  await report({ status: "completed", progress: 100 });
}

module.exports = { runTestProxy };
