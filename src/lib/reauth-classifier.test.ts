import { describe, expect, it } from "vitest";
import { isAppAuthError, isExternalServiceSessionError } from "./reauth-classifier";

describe("reauth classifier", () => {
  it("does not treat Facebook extraction session failures as app logout", () => {
    const errors = [
      new Error("SESSION_EXPIRED: Facebook session lost while extracting page audience"),
      new Error("Facebook rejected the stored session cookies: c_user missing"),
      new Error("حساب فيسبوك غير صالح حالياً: cookies expired"),
      new Error("checkpoint required while extracting commenters"),
    ];

    for (const error of errors) {
      expect(isExternalServiceSessionError(error)).toBe(true);
      expect(isAppAuthError(error)).toBe(false);
    }
  });

  it("still treats real application auth failures as app auth errors", () => {
    expect(isAppAuthError(new Response("Unauthorized", { status: 401 }))).toBe(true);
    expect(isAppAuthError(new Error("Unauthorized: No authorization header provided"))).toBe(true);
    expect(isAppAuthError(new Error("jwt expired"))).toBe(true);
  });
});