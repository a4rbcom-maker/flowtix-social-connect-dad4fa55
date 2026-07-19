// Extracts a User Access Token from an authenticated Facebook session
// (Business Suite embeds one in the initial HTML for its own Graph API calls).
// The token is reported back once — the server encrypts it into
// fb_bot_accounts.graph_token_encrypted and redacts the plaintext from
// fb_job_results before persisting.

const { extractGraphTokenFromSession, shortError } = require("./messenger-stable-pipeline");

// Hard cap so a slow / broken FB response can never keep the job "running"
// for tens of minutes.  Individual page.goto has its own tighter cap.
const OVERALL_BUDGET_MS = 45_000;
const PER_URL_TIMEOUT_MS = 12_000;

async function runMessengerExtractToken(ctx) {
  const { page, job, report } = ctx;
  const accountId = job?.account?.id || null;

  await report({ status: "running", progress: 10 });
  let timeoutId = null;
  try {
    const found = await Promise.race([
      extractGraphTokenFromSession(page, report, {
        perUrlTimeoutMs: PER_URL_TIMEOUT_MS,
        readyTimeoutMs: 3_500,
        settleMs: 200,
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("انتهت المهلة الكلية قبل العثور على التوكن")), OVERALL_BUDGET_MS);
      }),
    ]);
    if (found?.token) {
        await report({
          result: {
            target: "graph_token",
            status: "success",
            data: {
              kind: "graph_token",
              account_id: accountId,
              token: found.token,
              source: "network_or_session",
              extracted_at: new Date().toISOString(),
              probe_url: "business.facebook.com",
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
    const raw = shortError(err, 240);
    let human = "لم نتمكن من استخراج توكن Graph API من جلسة الحساب.";
    if (/SESSION_EXPIRED|login|checkpoint/i.test(raw)) {
      human = "الجلسة منتهية — Facebook طلب إعادة تسجيل دخول. حدّث الكوكيز أولاً ثم أعد المحاولة.";
    } else if (/timeout|Timeout|TimeoutError|المهلة/i.test(raw)) {
      human = "الاستخراج لم ينجح بسرعة. تحقق من البروكسي أو أعد ربط الحساب ثم جرّب مرة أخرى.";
    }
    await report({ status: "failed", errorMessage: raw ? `${human} (${raw})` : human, progress: 100 });
    return;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  await report({
    status: "failed",
    errorMessage: "لم نتمكن من استخراج توكن Graph API من جلسة الحساب.",
    progress: 100,
  });
}

module.exports = { runMessengerExtractToken };
