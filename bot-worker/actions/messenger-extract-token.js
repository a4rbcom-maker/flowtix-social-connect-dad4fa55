// Extracts a User Access Token from an authenticated Facebook session
// (Business Suite embeds one in the initial HTML for its own Graph API calls).
// The token is reported back once — the server encrypts it into
// fb_bot_accounts.graph_token_encrypted and redacts the plaintext from
// fb_job_results before persisting.

const CANDIDATE_URLS = [
  "https://business.facebook.com/latest/home",
  "https://business.facebook.com/business_locations",
  "https://business.facebook.com/latest/inbox/all",
];

async function scanForAccessToken(page) {
  // 1) Try DOM/HTML regex patterns first (fast, no extra request).
  const html = await page.content();
  const patterns = [
    /"accessToken"\s*:\s*"(EAA[A-Za-z0-9_-]{80,})"/,
    /"access_token"\s*:\s*"(EAA[A-Za-z0-9_-]{80,})"/,
    /\baccessToken\s*=\s*"(EAA[A-Za-z0-9_-]{80,})"/,
    /(EAA[G-Z][A-Za-z0-9_-]{100,})/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return { token: m[1], source: "html_regex" };
  }
  // 2) Try in-page eval as a fallback.
  const inPage = await page.evaluate(() => {
    try {
      const src = document.documentElement.innerHTML;
      const m = src.match(/EAA[G-Z][A-Za-z0-9_-]{100,}/);
      return m ? m[0] : null;
    } catch {
      return null;
    }
  });
  if (inPage) return { token: inPage, source: "in_page_eval" };
  return null;
}

// Hard cap so a slow / broken FB response can never keep the job "running"
// for tens of minutes.  Individual page.goto has its own tighter cap.
const OVERALL_BUDGET_MS = 90_000;
const PER_URL_TIMEOUT_MS = 22_000;

async function runMessengerExtractToken(ctx) {
  const { page, job, report } = ctx;
  const accountId = job?.account?.id || null;

  await report({ status: "running", progress: 10 });
  const deadline = Date.now() + OVERALL_BUDGET_MS;

  let lastErr = null;
  for (let i = 0; i < CANDIDATE_URLS.length; i += 1) {
    if (Date.now() > deadline) {
      lastErr = new Error("انتهت المهلة الكلية قبل العثور على التوكن");
      break;
    }
    const url = CANDIDATE_URLS[i];
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: PER_URL_TIMEOUT_MS });
      await report({ progress: 20 + i * 20 });
      // Short wait so JS-injected tokens land in the DOM.
      await new Promise((r) => setTimeout(r, 800));

      // If FB bounced us to login/checkpoint, no point in scanning further URLs.
      const current = page.url() || "";
      if (/\/login|checkpoint|two_factor|recover/i.test(current)) {
        lastErr = new Error("SESSION_EXPIRED: تم إعادة التوجيه إلى صفحة تسجيل الدخول");
        break;
      }

      const found = await scanForAccessToken(page);
      if (found?.token) {
        await report({
          result: {
            target: "graph_token",
            status: "success",
            data: {
              kind: "graph_token",
              account_id: accountId,
              token: found.token,
              source: found.source,
              extracted_at: new Date().toISOString(),
              probe_url: url,
            },
          },
          status: "completed",
          progress: 100,
          processedItems: 1,
          totalItems: 1,
        });
        return;
      }
    } catch (err) {
      lastErr = err;
    }
  }

  const raw = String(lastErr?.message || lastErr || "").slice(0, 240);
  let human = "لم نتمكن من استخراج توكن Graph API من جلسة الحساب.";
  if (/SESSION_EXPIRED|login|checkpoint/i.test(raw)) {
    human = "الجلسة منتهية — Facebook طلب إعادة تسجيل دخول. حدّث الكوكيز أولاً ثم أعد المحاولة.";
  } else if (/timeout|Timeout|TimeoutError/i.test(raw)) {
    human = "استغرق تحميل Business Suite وقتاً أطول من المسموح. تحقق من البروكسي واستقرار الاتصال ثم أعد المحاولة.";
  }
  await report({
    status: "failed",
    errorMessage: raw ? `${human} (${raw})` : human,
  });
}

module.exports = { runMessengerExtractToken };
