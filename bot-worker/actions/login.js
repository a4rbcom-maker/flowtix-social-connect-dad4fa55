// Login to Facebook using either stored cookies or email/password.
// On checkpoint/2FA detection, reports back so the UI marks the account as "checkpoint".
const FB_HOME = "https://www.facebook.com/";

async function ensureLogin(page, account, reportStatus) {
  try {
    if (account.authMethod === "cookies" && account.credentials?.cookies) {
      const cookies = account.credentials.cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || ".facebook.com",
        path: c.path || "/",
        httpOnly: !!c.httpOnly,
        secure: c.secure !== false,
        sameSite: c.sameSite || "Lax",
        expires: typeof c.expires === "number" ? c.expires : undefined,
      }));
      await page.setCookie(...cookies);
      try {
        await page.goto(FB_HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

    // ---- Verify login state with multiple, layered checks ----
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
    const browserCookies = await page.cookies("https://www.facebook.com");
    const cUser = browserCookies.find((c) => c.name === "c_user");
    if (!cUser || !cUser.value) {
      await reportStatus("invalid", "c_user cookie missing after navigation — session was rejected by Facebook");
      return false;
    }

    // 4) Positive logged-in signals: nav role + a profile/me link or composer
    const positive = await page.evaluate(() => {
      const hasNav = !!document.querySelector('[role="navigation"]');
      const hasProfileLink = !!document.querySelector(
        'a[href*="/me"], a[href*="/profile.php"], a[aria-label]',
      );
      const hasComposer = !!document.querySelector('[role="feed"], [aria-label*="Create"], [aria-label*="إنشاء"]');
      return { hasNav, hasProfileLink, hasComposer };
    });
    if (!positive.hasNav && !positive.hasProfileLink && !positive.hasComposer) {
      await reportStatus(
        "invalid",
        "Could not confirm logged-in UI (no nav/profile/composer detected)",
      );
      return false;
    }

    await reportStatus("active", null);
    return true;
  } catch (e) {
    await reportStatus("invalid", `LOGIN_EXCEPTION: ${String(e.message || e)}`);
    return false;
  }
}

module.exports = { ensureLogin };
