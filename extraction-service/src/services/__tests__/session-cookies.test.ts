import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldPersistSessionCookies, type CookieEntry } from "../../types.js";

const mk = (name: string, value: string, expires?: number): CookieEntry => ({
  name,
  value,
  domain: ".facebook.com",
  path: "/",
  expires: expires ?? Math.floor(Date.now() / 1000) + 86400,
  httpOnly: true,
  secure: true,
});

const LIVE = [
  mk("c_user", "100012345678901"),
  mk("xs", "31%3Aabcdef0123456789"),
  mk("fr", "0aBcDeF.1.AbcDef"),
  mk("datr", "AbCdEfGhIjKlMnOpQrStUvWx"),
];

test("live identity with c_user + xs + fr + datr IS persisted", () => {
  assert.equal(shouldPersistSessionCookies(LIVE), true);
});

test("login-page jar without xs is REFUSED (this is the forced-logout bug)", () => {
  const loginJar = [mk("datr", "AbCdEfGhIjKlMnOpQrStUvWx"), mk("fr", "0aBcDeF.1.AbcDef")];
  assert.equal(shouldPersistSessionCookies(loginJar), false);
});

test("missing c_user is REFUSED", () => {
  const noUser = [mk("xs", "31%3Aabcdef"), mk("fr", "0aBcDeF.1.AbcDef"), mk("datr", "x")];
  assert.equal(shouldPersistSessionCookies(noUser), false);
});

test("empty or missing cookie list is REFUSED", () => {
  assert.equal(shouldPersistSessionCookies([]), false);
  assert.equal(shouldPersistSessionCookies(undefined as unknown as CookieEntry[]), false);
});

test("expired xs token is REFUSED", () => {
  const expired = [
    mk("c_user", "100012345678901"),
    mk("xs", "31%3Aabcdef", Math.floor(Date.now() / 1000) - 60),
    mk("fr", "0aBcDeF.1.AbcDef"),
    mk("datr", "x"),
  ];
  assert.equal(shouldPersistSessionCookies(expired), false);
});

test("blank token values are REFUSED", () => {
  const blank = [
    mk("c_user", ""),
    mk("xs", ""),
    mk("fr", "0aBcDeF.1.AbcDef"),
    mk("datr", "x"),
  ];
  assert.equal(shouldPersistSessionCookies(blank), false);
});
