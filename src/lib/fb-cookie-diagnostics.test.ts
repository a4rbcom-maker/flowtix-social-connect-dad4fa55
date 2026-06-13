import { describe, expect, it } from "vitest";
import {
  cookieValidationMessage,
  parseCookiesInputDetailed,
  validateFacebookCookies,
} from "./fb-cookie-diagnostics";

const future = Math.floor(Date.now() / 1000) + 86_400 * 30;
const past = Math.floor(Date.now() / 1000) - 86_400;

function cookie(name: string, value: string, expirationDate = future) {
  return { name, value, domain: ".facebook.com", path: "/", expirationDate };
}

describe("Facebook cookie diagnostics", () => {
  it("accepts valid Cookie-Editor JSON and extracts the Facebook user id", () => {
    const input = JSON.stringify([
      cookie("c_user", "123456789"),
      cookie("xs", "1234567890abcdef"),
      cookie("fr", "fr-value"),
      cookie("datr", "datr-value"),
      cookie("sb", "sb-value"),
    ]);

    const parsed = parseCookiesInputDetailed(input);
    expect(parsed.ok).toBe(true);
    expect(parsed.cookies).toHaveLength(5);

    const validation = validateFacebookCookies(parsed.cookies);
    expect(validation.missingCritical).toEqual([]);
    expect(validation.invalid).toEqual([]);
    expect(validation.detectedUserId).toBe("123456789");
  });

  it("reports invalid JSON without falling through to a generic parser", () => {
    const parsed = parseCookiesInputDetailed('[{"name":"c_user","value":"123"}');
    expect(parsed.ok).toBe(false);
    expect(parsed.debugCode).toBe("INVALID_JSON");
    expect(parsed.message).toContain("JSON غير صالح");
  });

  it("reports expired cookie sessions", () => {
    const parsed = parseCookiesInputDetailed(JSON.stringify([
      cookie("c_user", "123456789", past),
      cookie("xs", "1234567890abcdef", future),
      cookie("fr", "fr-value", future),
      cookie("datr", "datr-value", future),
    ]));

    const validation = validateFacebookCookies(parsed.cookies);
    expect(validation.expired).toBe(true);
    expect(cookieValidationMessage(validation)).toContain("انتهت صلاحية الجلسة");
  });

  it("reports logged-out exports with no valid Facebook session cookies", () => {
    const parsed = parseCookiesInputDetailed(JSON.stringify([cookie("locale", "ar_AR") ]));
    const validation = validateFacebookCookies(parsed.cookies);
    expect(validation.missingCritical).toEqual(["c_user", "xs", "fr", "datr"]);
    expect(cookieValidationMessage(validation)).toContain("لا توجد Session صالحة");
  });


  it("accepts the real user-uploaded Cookie-Editor export", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const raw = await fs.readFile(
      path.resolve(__dirname, "__fixtures__/fb-cookies-sample.json"),
      "utf8",
    );
    const parsed = parseCookiesInputDetailed(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.cookies.length).toBeGreaterThanOrEqual(5);
    const validation = validateFacebookCookies(parsed.cookies);
    expect(validation.missingCritical).toEqual([]);
    expect(validation.invalid).toEqual([]);
    expect(validation.detectedUserId).toBe("61590157555205");
    expect(validation.expired).toBe(false);
  });
});