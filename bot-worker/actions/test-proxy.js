// Diagnostic job: launches Chromium (with the current proxy args passed by
// index.js) and asks a public IP echo service what egress IP the browser is
// using. Returns that IP as a job result so the UI can render it directly —
// no terminal / curl needed.
//
// This action deliberately does NOT log into Facebook. Testing a proxy should
// never touch the user's real FB session (which could invalidate it).

function classifyError(raw, proxyEnabled) {
  const msg = String(raw || "").toLowerCase();
  // Normalize common Chromium / network error codes into a clear Arabic reason.
  if (msg.includes("err_proxy_connection_failed") || msg.includes("err_tunnel_connection_failed")) {
    return {
      code: "PROXY_UNREACHABLE",
      ar: "لم يستجب البروكسي إطلاقاً — تأكد أن الـ host والـ port صحيحين وأن السيرفر يسمح بالاتصال من IP الـ VPS.",
      en: "The proxy did not respond — verify host/port and that the proxy allows connections from the VPS IP.",
    };
  }
  if (msg.includes("err_proxy_auth") || msg.includes("407") || msg.includes("proxy authentication")) {
    return {
      code: "PROXY_AUTH",
      ar: "البروكسي رفض بيانات الدخول (user/pass غلط أو منتهية).",
      en: "Proxy rejected the credentials (wrong or expired user/pass).",
    };
  }
  if (msg.includes("err_name_not_resolved") || msg.includes("getaddrinfo") || msg.includes("enotfound")) {
    return {
      code: "DNS",
      ar: "اسم سيرفر البروكسي غير موجود — راجع الـ host (كتابة خطأ أو دومين معطل).",
      en: "Proxy hostname does not resolve — check the host spelling.",
    };
  }
  if (msg.includes("err_connection_refused") || msg.includes("econnrefused")) {
    return {
      code: "REFUSED",
      ar: "البروكسي رفض الاتصال — البورت مقفول أو الخدمة متوقفة.",
      en: "Connection refused by the proxy — port closed or service down.",
    };
  }
  if (msg.includes("err_connection_timed_out") || msg.includes("etimedout") || msg.includes("timeout")) {
    return {
      code: "TIMEOUT",
      ar: proxyEnabled
        ? "انتهت المهلة أثناء الاتصال عبر البروكسي — غالباً IP الـ VPS محظور عند مزوّد البروكسي أو البروكسي بطيء جداً."
        : "انتهت المهلة قبل الوصول لخدمة فحص الـ IP — الشبكة على السيرفر بطيئة أو محجوبة.",
      en: proxyEnabled
        ? "Timed out through the proxy — VPS IP may be blocked by the proxy provider, or the proxy is too slow."
        : "Timed out — server network is slow or blocked.",
    };
  }
  if (msg.includes("err_cert") || msg.includes("ssl") || msg.includes("certificate")) {
    return {
      code: "TLS",
      ar: "شهادة SSL مرفوضة أثناء الاتصال — البروكسي يعترض HTTPS بشكل غير موثوق.",
      en: "SSL certificate rejected — proxy is intercepting HTTPS insecurely.",
    };
  }
  if (msg.includes("err_empty_response") || msg.includes("err_http_response_code_failure")) {
    return {
      code: "EMPTY",
      ar: "البروكسي رد باستجابة فارغة — على الأرجح IP محظور من الموقع أو البروكسي معطّل.",
      en: "Proxy returned an empty response — the IP is likely blocked or the proxy is broken.",
    };
  }
  return {
    code: "UNKNOWN",
    ar: `سبب غير معروف: ${raw || "لا يوجد تفاصيل"}`,
    en: `Unknown reason: ${raw || "no details"}`,
  };
}

async function runTestProxy({ page, job, report }) {
  const startedAt = Date.now();
  const proxyEnabled = Boolean(job.payload?.proxyUrl || job.account?.proxyUrl);
  const targets = [
    { url: "https://api.ipify.org?format=json", parse: (t) => { try { return JSON.parse(t).ip; } catch { return null; } } },
    { url: "https://ifconfig.co/ip", parse: (t) => (t || "").trim() },
    { url: "https://ipv4.icanhazip.com/", parse: (t) => (t || "").trim() },
  ];

  await report({ status: "running", progress: 20 });

  let ip = null;
  let lastRaw = null;
  let lastStatus = null;
  for (const target of targets) {
    try {
      const resp = await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 25_000 });
      const status = resp ? resp.status() : 0;
      lastStatus = status;
      const body = await page.evaluate(() => document.body ? document.body.innerText : "");
      if (status >= 200 && status < 400) {
        const candidate = target.parse(body);
        if (candidate && /^[0-9a-fA-F.:]{3,45}$/.test(candidate)) {
          ip = candidate;
          break;
        }
        lastRaw = `الرد ${status} من ${target.url} غير مفهوم: ${(body || "").slice(0, 120)}`;
      } else {
        lastRaw = `HTTP ${status} من ${target.url}`;
      }
    } catch (e) {
      lastRaw = String(e && e.message ? e.message : e);
    }
    await report({ progress: 55 });
  }

  const elapsedMs = Date.now() - startedAt;

  if (!ip) {
    const cls = classifyError(lastRaw, proxyEnabled);
    const humanAr = `${cls.ar}${lastRaw ? `\nتفاصيل تقنية: ${lastRaw}` : ""}`;
    await report({
      result: {
        target: "test-proxy",
        status: "failed",
        error: humanAr,
        data: {
          kind: "proxy_test",
          ok: false,
          proxyEnabled,
          elapsedMs,
          reasonCode: cls.code,
          reasonAr: cls.ar,
          reasonEn: cls.en,
          rawError: lastRaw,
          lastStatus,
        },
      },
    });
    await report({
      status: "failed",
      progress: 100,
      errorMessage: cls.ar,
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
