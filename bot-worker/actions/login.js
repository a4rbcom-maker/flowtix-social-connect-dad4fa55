// Login to Facebook using either stored cookies or email/password.
// On checkpoint/2FA detection, reports back so the UI marks the account as "checkpoint".
const FB_HOME = "https://www.facebook.com/";

const FACEBOOK_COOKIE_DOMAINS = [
  ".facebook.com",
  "facebook.com",
  ".www.facebook.com",
  "www.facebook.com",
  ".business.facebook.com",
  "business.facebook.com",
];

function normalizeSameSite(value) {
  const raw = String(value || "").toLowerCase();
  if (raw === "strict") return "Strict";
  if (raw === "none" || raw === "no_restriction") return "None";
  return "Lax";
}

function normalizeCookieExpiry(cookie) {
  const raw = cookie.expires ?? cookie.expirationDate ?? cookie.expiry ?? cookie.expiresAt;
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return undefined;
  return n > 10_000_000_000 ? Math.floor(n / 1000) : Math.floor(n);
}

function buildPuppeteerCookies(sourceCookies) {
  const expanded = [];
  const importantGlobal = new Set(["c_user", "xs", "fr", "datr", "sb", "presence", "wd"]);
  for (const c of sourceCookies) {
    if (!c?.name || typeof c.value !== "string") continue;
    const originalDomain = String(c.domain || ".facebook.com").replace(/^https?:\/\//, "");
    const domains = importantGlobal.has(String(c.name))
      ? Array.from(new Set([originalDomain, ...FACEBOOK_COOKIE_DOMAINS]))
      : [originalDomain];
    for (const domain of domains) {
      expanded.push({
        name: String(c.name),
        value: String(c.value),
        domain,
        path: c.path || "/",
        httpOnly: !!c.httpOnly,
        secure: c.secure !== false,
        sameSite: normalizeSameSite(c.sameSite),
        expires: normalizeCookieExpiry(c),
      });
    }
  }
  return expanded;
}

async function verifyLoggedInSession(page, reportStatus, options = {}) {
  const url = page.url();

  // 1) Hard checkpoint signals from URL
  if (url.includes("/checkpoint/") || url.includes("/two_factor/") || url.includes("two_step_verification")) {
    await reportStatus("checkpoint", `Facebook checkpoint page detected: ${url}`);
    return false;
  }

  // 2) Hard login-required signal
  if (url.includes("/login") || url.includes("login.php")) {
    await reportStatus("invalid", "Facebook redirected to /login — cookies are not valid anymore");
    return false;
  }

  // 3) c_user cookie must still be present after FB processes our cookies
  const browserCookies = await page.cookies("https://www.facebook.com", "https://business.facebook.com");
  const cUser = browserCookies.find((c) => c.name === "c_user");
  if (!cUser || !cUser.value) {
    await reportStatus("invalid", "Facebook rejected the stored session cookies after navigation. Re-export fresh cookies from the same logged-in browser, then update the bot account.");
    return false;
  }

  // 4) Positive logged-in signals. Business Suite pages sometimes render a
  // different shell from facebook.com, so accept either the normal Facebook UI
  // or an authenticated Business Suite surface.
  const positive = await page.evaluate(() => {
    const current = new URL(window.location.href);
    const hasNav = !!document.querySelector('[role="navigation"]');
    const hasProfileLink = !!document.querySelector(
      'a[href*="/me"], a[href*="/profile.php"], a[aria-label]',
    );
    const hasComposer = !!document.querySelector('[role="feed"], [aria-label*="Create"], [aria-label*="إنشاء"]');
    const onBusinessSuite = /(^|\.)business\.facebook\.com$/i.test(current.hostname);
    const bodyText = document.body?.innerText || "";
    const hasBusinessChrome = onBusinessSuite && /Meta Business Suite|Business Suite|Inbox|Planner|Content|الإشعارات|صندوق|الأعمال/i.test(bodyText);
    const loginLike = /log in|login|checkpoint|تسجيل الدخول|تحقق/i.test(bodyText) || /\/login|checkpoint/i.test(current.href);
    return { hasNav, hasProfileLink, hasComposer, hasBusinessChrome, loginLike };
  });
  if (positive.loginLike) {
    await reportStatus("invalid", `Facebook requested login/checkpoint on protected surface: ${url}`);
    return false;
  }
  if (!positive.hasNav && !positive.hasProfileLink && !positive.hasComposer && !positive.hasBusinessChrome) {
    await reportStatus(
      "invalid",
      "Could not confirm logged-in UI (no nav/profile/composer/business shell detected)",
    );
    return false;
  }

  // Some Facebook sessions look valid on the homepage but are rejected only
  // when opening a protected product surface (Pages/Groups/Messenger). For
  // page extraction, perform that navigation before the job starts scraping
  // so the UI fails early with a precise reason instead of waiting for a
  // long extraction attempt.
  if (options.verifyUrl) {
    try {
      await page.goto(options.verifyUrl, { waitUntil: "domcontentloaded", timeout: options.verifyTimeoutMs || 45_000 });
    } catch (e) {
      await reportStatus("invalid", `FACEBOOK_PAGE_TIMEOUT: ${String(e.message || e)}`);
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const verifyUrl = page.url();
    if (/\/login(?:\/|\?|$)|checkpoint|two_factor|two_step_verification/i.test(verifyUrl)) {
      await reportStatus("invalid", `Facebook redirected to login/checkpoint while opening ${options.verifyUrl}`);
      return false;
    }
    const protectedCookies = await page.cookies("https://www.facebook.com", "https://business.facebook.com");
    const protectedCUser = protectedCookies.find((c) => c.name === "c_user");
    if (!protectedCUser || !protectedCUser.value) {
      await reportStatus("invalid", "Facebook rejected the stored session cookies after opening the requested Facebook section. Re-export fresh cookies from the same logged-in browser, then update the bot account.");
      return false;
    }
  }

  await reportStatus("active", null);
  return true;
}

async function ensureLogin(page, account, reportStatus, options = {}) {
  try {
    if (account.authMethod === "cookies" && account.credentials?.cookies) {
      const sourceCookies = Array.isArray(account.credentials.cookies) ? account.credentials.cookies : [];
      const cookieNames = new Set(sourceCookies.map((c) => String(c?.name || "")));
      const missingRequired = ["c_user", "xs"].filter((name) => !cookieNames.has(name));
      if (missingRequired.length > 0) {
        await reportStatus(
          "invalid",
          `Stored Facebook cookies are incomplete; missing ${missingRequired.join(", ")}. Re-export cookies while logged into Facebook.`,
        );
        return false;
      }

      const firstUrl = options.initialUrl || FB_HOME;
      if (options.preferExistingSession) {
        try {
          await page.goto(firstUrl, { waitUntil: "domcontentloaded", timeout: options.initialTimeoutMs || 45_000 });
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const existingOk = await verifyLoggedInSession(page, async () => {}, { verifyUrl: options.verifyUrl });
          if (existingOk) {
            await reportStatus("active", null);
            return true;
          }
        } catch (_) {
          // Fall through to importing the stored cookies.
        }
      }

      const cookies = buildPuppeteerCookies(sourceCookies);
      await page.setCookie(...cookies);
      try {
        await page.goto(firstUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      } catch (e) {
        await reportStatus(
          "invalid",
          `FACEBOOK_PAGE_TIMEOUT: ${String(e.message || e)}`,
        );
        return false;
      }
    } else if (account.authMethod === "credentials" && account.credentials?.email) {
      await page.goto("https://www.facebook.com/login/", { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.type('input[name="email"]', account.credentials.email, { delay: 40 });
      await page.type('input[name="pass"]', account.credentials.password, { delay: 40 });
      await Promise.all([
        page.click('button[name="login"]'),
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {}),
      ]);
    } else {
      await reportStatus("invalid", "Missing credentials in payload");
      return false;
    }

    return verifyLoggedInSession(page, reportStatus, options);
  } catch (e) {
    await reportStatus("invalid", `LOGIN_EXCEPTION: ${String(e.message || e)}`);
    return false;
  }
}

module.exports = { ensureLogin };
