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
      await page.goto(FB_HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

    // Verify login state
    const url = page.url();
    if (url.includes("/checkpoint/") || url.includes("/two_factor/")) {
      await reportStatus("checkpoint", "Account requires manual verification");
      return false;
    }
    // Heuristic: presence of the global nav search field implies logged in
    const loggedIn = await page.evaluate(() => !!document.querySelector('[role="navigation"]'));
    if (!loggedIn) {
      await reportStatus("invalid", "Could not confirm logged-in state");
      return false;
    }
    await reportStatus("active", null);
    return true;
  } catch (e) {
    await reportStatus("invalid", String(e.message || e));
    return false;
  }
}

module.exports = { ensureLogin };
