// Integration test: after signOut runs its impersonation cleanup, the
// ImpersonationBanner (which renders null when readImpersonationBackup()
// returns null) must stay hidden — even when impersonation keys, session
// keys, and cookies existed before signOut. Reloading the page rebuilds
// state purely from storage + cookies, so if those are wiped the banner
// cannot come back.
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------- Minimal browser shim (vitest env is "node") ----------

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
}

type CookieJar = { value: string };

function installBrowserGlobals() {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const jar: CookieJar = { value: "" };

  const doc = {
    get cookie() {
      return jar.value;
    },
    // Handle "name=; expires=...; path=/" style writes by removing the named entry.
    set cookie(raw: string) {
      const [pair, ...attrs] = raw.split(";").map((s) => s.trim());
      const [name, value = ""] = pair.split("=");
      const isExpired = attrs.some((a) => {
        const lower = a.toLowerCase();
        if (lower.startsWith("expires=")) {
          const d = new Date(a.slice("expires=".length));
          return !Number.isNaN(d.getTime()) && d.getTime() <= Date.now();
        }
        if (lower.startsWith("max-age=")) {
          return Number(lower.slice("max-age=".length)) <= 0;
        }
        return false;
      });
      const entries = jar.value
        ? jar.value.split(";").map((c) => c.trim()).filter(Boolean)
        : [];
      const filtered = entries.filter((c) => c.split("=")[0].trim() !== name);
      if (!isExpired) filtered.push(`${name}=${value}`);
      jar.value = filtered.join("; ");
    },
  };

  const win = {
    localStorage,
    sessionStorage,
    location: { hostname: "localhost" },
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    CustomEvent: class {
      constructor(public type: string, public init?: unknown) {}
    },
  };

  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("sessionStorage", sessionStorage);
  vi.stubGlobal("CustomEvent", win.CustomEvent);

  return { localStorage, sessionStorage, jar };
}

// Seed the storages + cookies the way an active impersonation session would
// (plus a few legacy/adjacent keys the sweep is expected to catch).
function seedImpersonationState(
  localStorage: Storage,
  sessionStorage: Storage,
  jar: CookieJar,
  BACKUP_KEY: string,
) {
  localStorage.setItem(
    BACKUP_KEY,
    JSON.stringify({
      access_token: "at",
      refresh_token: "rt",
      admin_email: "admin@x.com",
      target_email: "user@x.com",
      saved_at: Date.now(),
    }),
  );
  localStorage.setItem("flowtix_admin_extra", "1");
  localStorage.setItem("legacy_impersonation_ctx", "1");
  sessionStorage.setItem("impersonation_meta", "1");
  sessionStorage.setItem("flowtix_admin_session", "1");
  jar.value =
    "flowtix_admin_ref=1; impersonation_note=1; other_cookie=keep";
}

// ---------- Test ----------

describe("signOut → ImpersonationBanner stays hidden after reload", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it(
    "wipes impersonation from localStorage, sessionStorage, and cookies, " +
      "so readImpersonationBackup() returns null (banner renders null)",
    async () => {
      const { localStorage, sessionStorage, jar } = installBrowserGlobals();

      const impersonation = await import("./impersonation");
      const { IMPERSONATION_BACKUP_KEY, clearImpersonationBackup, readImpersonationBackup } =
        impersonation;

      seedImpersonationState(localStorage, sessionStorage, jar, IMPERSONATION_BACKUP_KEY);

      // Sanity: backup is present pre-signOut, so the banner WOULD render.
      expect(readImpersonationBackup()).not.toBeNull();

      // This is exactly the cleanup signOut() in src/lib/auth.tsx calls
      // (in every branch — successful admin restore, failed restore, or
      // plain user signOut).
      clearImpersonationBackup();

      // After cleanup, the banner mounts with backup=null → returns null,
      // and a hard page reload rebuilds from these same storages.
      expect(readImpersonationBackup()).toBeNull();

      const scan = (s: Storage) => {
        const out: string[] = [];
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (!k) continue;
          if (
            k === IMPERSONATION_BACKUP_KEY ||
            k.toLowerCase().includes("impersonat") ||
            k.startsWith("flowtix_admin_")
          ) {
            out.push(k);
          }
        }
        return out;
      };

      expect(scan(localStorage)).toEqual([]);
      expect(scan(sessionStorage)).toEqual([]);

      const remainingCookies = (jar.value || "")
        .split(";")
        .map((c) => c.split("=")[0].trim())
        .filter(Boolean);
      expect(
        remainingCookies.filter(
          (n) => n.toLowerCase().includes("impersonat") || n.startsWith("flowtix_admin_"),
        ),
      ).toEqual([]);
      // Non-impersonation cookies must be preserved.
      expect(remainingCookies).toContain("other_cookie");
    },
  );
});
