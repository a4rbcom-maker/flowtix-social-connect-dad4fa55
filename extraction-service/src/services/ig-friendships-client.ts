/** Instagram friendships API client — the fast path.
 *
 *  Live-verified 2026-08-24 (session insta1, target @tourismegypt):
 *   - GET /api/v1/friendships/<id>/followers/?count=50[&max_id=...] → 25
 *     users/page, next_max_id honored (page 2 fully distinct), ~600ms/page.
 *   - Same shape for /following/.
 *   - Numeric target id resolves from the profile HTML ("userID":"...") —
 *     web_profile_info returns 400 (deleted schema) and must not be used.
 *   - The in-page fetch rides the logged-in session (cookies+fingerprint);
 *     429/401/403 = block signal for the engine's session rotation.
 *  DOM scrolling remains the fallback when the API path fails. */
import type { Page } from "playwright";
import { logger } from "../logger.js";

const log = logger;

export interface IgApiUser {
  username: string;
  fullName: string;
  avatar: string;
  pk: string;
  isPrivate: boolean;
  verified: boolean;
}

export interface IgFriendshipsPage {
  users: IgApiUser[];
  nextMaxId: string | null;
}

export class IgFriendshipsClient {
  private lastRequestMs = 0;
  private readonly minGapMs: number;

  constructor(minGapMs = 900) {
    this.minGapMs = minGapMs;
  }

  /** Resolve the numeric target id. The dialog's friendships link carries it
   *  (…/friendships/<id>/followers/) — the HTML "userID" is the VIEWER's id
   *  (session owner), never the target's. Fallback: xdt feed node ids
   *  ("<pk>_<owner_id>") from the profile's embedded timeline JSON. */
  async resolveUserId(page: Page, username: string): Promise<string | null> {
    return page
      .evaluate(async (user: string) => {
        // 1) canonical: friendships link on the profile page
        const html = await fetch(`https://www.instagram.com/${user}/`, { credentials: "include" }).then((r) => r.text());
        const m = html.match(/friendships\/(\d+)\//);
        if (m) return m[1];
        // 2) timeline media ids: "<mediaPk>_<ownerId>"
        const m2 = html.match(/"id":"(\d+)_(\d+)"/);
        if (m2) return m2[2];
        return null;
      }, username)
      .catch(() => null);
  }

  /** Fetch one page of followers/following. Returns null on block/parse fail. */
  async fetchPage(
    page: Page,
    userId: string,
    tab: "followers" | "following",
    maxId: string | null,
  ): Promise<IgFriendshipsPage | null> {
    await this.pace();
    return page
      .evaluate(
        async ({ userId, tab, maxId }) => {
          const url =
            `https://www.instagram.com/api/v1/friendships/${userId}/${tab}/?count=50` +
            (maxId ? `&max_id=${encodeURIComponent(maxId)}` : "");
          const res = await fetch(url, {
            credentials: "include",
            headers: { "x-ig-app-id": "936619743392459", accept: "*/*" },
          });
          if (res.status !== 200) return { error: true, status: res.status as number };
          const j = await res.json().catch(() => null);
          if (!j || !Array.isArray(j.users)) return { error: true, status: 0 };
          const users = j.users.map((u: Record<string, unknown>) => ({
            username: String(u.username ?? ""),
            fullName: String(u.full_name ?? ""),
            avatar: String(u.profile_pic_url ?? ""),
            pk: String(u.pk ?? u.username ?? ""),
            isPrivate: !!u.is_private,
            verified: !!u.is_verified,
          })).filter((u: { username: string }) => u.username);
          return { error: false, users, nextMaxId: (j.next_max_id as string | null) ?? null };
        },
        { userId, tab, maxId },
      )
      .then((r: { error: boolean; status?: number; users?: IgApiUser[]; nextMaxId?: string | null }) => {
        if (r.error) {
          log.warn("IgFriendships", `page fetch failed (status ${r.status ?? "parse"})`);
          return null;
        }
        return { users: r.users ?? [], nextMaxId: r.nextMaxId ?? null };
      })
      .catch((err) => {
        log.warn("IgFriendships", `page fetch threw: ${String(err).slice(0, 100)}`);
        return null;
      });
  }

  private async pace(): Promise<void> {
    const now = Date.now();
    const wait = this.lastRequestMs + this.minGapMs - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestMs = Date.now();
  }
}
