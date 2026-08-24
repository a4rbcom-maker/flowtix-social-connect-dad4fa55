/** Instagram GraphQL client: capture live doc_ids from a logged-in page,
 *  then replay paginated queries through the page's own fetch (same session,
 *  cookies and fingerprint — never an external request).
 *
 *  Instagram's web UI issues POSTs to /api/v1/graphql/query (and legacy
 *  /graphql/query) with fb_api_req_friendly_name + variables carrying the
 *  cursor. We capture those templates on a warm-up navigation, then call
 *  fetchPage with a new cursor for fast pagination without DOM scrolling.
 *  DOM scrolling stays the fallback path (selectors verified live). */
import type { Page } from "playwright";
import { logger } from "../logger.js";

const log = logger;

export interface IgGraphqlRow {
  username: string;
  fullName: string;
  avatar: string;
  pk: string;
}

export interface IgGraphqlPage {
  rows: IgGraphqlRow[];
  total: number | null;
  hasNext: boolean;
  endCursor: string | null;
}

export interface CapturedIgQuery {
  url: string;
  friendlyName: string | null;
  docId: string | null;
  variables: Record<string, unknown> | null;
  queryHash: string | null;
}

interface EdgeNode {
  id?: string;
  username?: string;
  full_name?: string;
  profile_pic_url?: string;
}

/** Parse a followers/following page payload (edge_followed_by / edge_follow). */
export function parseIgGraphqlFollowersPage(raw: string, tab: "followers" | "following"): IgGraphqlPage | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const user = (body as { data?: { user?: Record<string, unknown> } })?.data?.user;
  if (!user) return null;
  const edge = tab === "followers" ? user.edge_followed_by : user.edge_follow;
  const conn = edge as { count?: number; page_info?: { has_next_page?: boolean; end_cursor?: string | null }; edges?: { node: EdgeNode }[] } | undefined;
  if (!conn) return null;
  const rows: IgGraphqlRow[] = [];
  for (const e of conn.edges ?? []) {
    const n = e?.node;
    if (!n?.username) continue;
    rows.push({
      username: n.username,
      fullName: n.full_name ?? "",
      avatar: (n.profile_pic_url as string) ?? "",
      pk: String(n.id ?? n.username),
    });
  }
  return {
    rows,
    total: typeof conn.count === "number" ? conn.count : null,
    hasNext: !!conn.page_info?.has_next_page,
    endCursor: conn.page_info?.end_cursor ?? null,
  };
}

/** Read end_cursor from any xdt_* media connection (likes, comments). */
export function extractXdtGqlCursor(body: unknown, edgeKey: string): string | null {
  const media = (body as { data?: Record<string, unknown> })?.data?.xdt_shortcode_media as Record<string, unknown> | undefined;
  if (!media) return null;
  const conn = media[edgeKey] as { page_info?: { end_cursor?: string | null } } | undefined;
  return conn?.page_info?.end_cursor ?? null;
}

/** Map an xdt comment edge to unique users (comment authors). */
export function igGraphqlUsersFromEdge(body: unknown, edgeKey: string): IgGraphqlRow[] {
  const media = (body as { data?: Record<string, unknown> })?.data?.xdt_shortcode_media as Record<string, unknown> | undefined;
  if (!media) return [];
  const conn = media[edgeKey] as { edges?: { node?: { owner?: EdgeNode } }[] } | undefined;
  const out: IgGraphqlRow[] = [];
  const seen = new Set<string>();
  for (const e of conn?.edges ?? []) {
    const owner = e?.node?.owner;
    if (!owner?.username || seen.has(owner.username)) continue;
    seen.add(owner.username);
    out.push({ username: owner.username, fullName: owner.full_name ?? "", avatar: "", pk: String(owner.id ?? owner.username) });
  }
  return out;
}

export class IgGraphQLClient {
  private captured = new Map<string, CapturedIgQuery>();
  private listener: ((args: unknown) => void) | null = null;

  /** Start capturing GraphQL templates issued by the live page. */
  attach(page: Page): void {
    this.detach();
    this.listener = (args: unknown) => {
      try {
        const req = (args as { url: () => string; method: () => string; postData: () => string | null }).url
          ? (args as { url: () => string; method: () => string; postData: () => string | null })
          : null;
        if (!req) return;
        const url = req.url();
        if (!url.includes("/graphql/query")) return;
        if (req.method() !== "POST" && !url.includes("variables=")) return;
        const u = new URL(url);
        const friendly = u.searchParams.get("fb_api_req_friendly_name") ?? null;
        const key = friendly ?? u.searchParams.get("doc_id") ?? url;
        const variablesRaw = u.searchParams.get("variables");
        let variables: Record<string, unknown> | null = null;
        try {
          variables = variablesRaw ? JSON.parse(variablesRaw) : null;
        } catch { /* keep null */ }
        this.captured.set(key, {
          url: `${u.origin}${u.pathname}`,
          friendlyName: friendly,
          docId: u.searchParams.get("doc_id"),
          queryHash: u.searchParams.get("query_hash"),
          variables,
        });
      } catch { /* capture must never throw */ }
    };
    page.on("request", this.listener as never);
  }

  detach(): void {
    if (this.listener) this.listener = null;
    this.captured.clear();
  }

  /** All captured templates (diagnostics + planning). */
  capturedQueries(): CapturedIgQuery[] {
    return [...this.captured.values()];
  }

  findQueryByName(nameRe: RegExp): CapturedIgQuery | null {
    for (const q of this.captured.values()) {
      if (q.friendlyName && nameRe.test(q.friendlyName)) return q;
    }
    return null;
  }

  /** Replay a captured GET-style query with overridden variables, executing
   *  fetch INSIDE the page (same session, cookies, fingerprint). */
  async fetchPage(
    page: Page,
    template: CapturedIgQuery,
    variablesOverride: Record<string, unknown>,
    timeoutMs = 15_000,
  ): Promise<unknown> {
    const vars = { ...(template.variables ?? {}), ...variablesOverride };
    const params = new URLSearchParams();
    if (template.docId) params.set("doc_id", template.docId);
    if (template.queryHash) params.set("query_hash", template.queryHash);
    if (template.friendlyName) params.set("fb_api_req_friendly_name", template.friendlyName);
    params.set("variables", JSON.stringify(vars));
    const url = `${template.url}?${params.toString()}`;

    return page.evaluate(
      async ({ url, timeoutMs }) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const res = await fetch(url, {
            method: "GET",
            credentials: "include",
            headers: { "x-ig-app-id": "936619743392459", accept: "*/*" },
            signal: ctrl.signal,
          });
          const text = await res.text();
          return { status: res.status, text };
        } finally {
          clearTimeout(t);
        }
      },
      { url, timeoutMs },
    ).then((r: { status: number; text: string }) => {
      if (r.status === 429 || r.status === 401 || r.status === 403) {
        log.warn("IgGraphQL", `fetch blocked (status ${r.status}) — treating as session signal`);
      }
      try {
        return JSON.parse(r.text);
      } catch {
        return null;
      }
    });
  }
}
