import type { Page, Request, Response } from "playwright";
import { logger } from "../logger.js";

const log = logger;

export interface GraphQLUser {
  id: string;
  name: string;
  url: string;
  reaction_type?: string;
  comment_text?: string;
}

export interface GraphQLPage {
  users: GraphQLUser[];
  endCursor: string | null;
  hasNextPage: boolean;
}

export interface CapturedRequest {
  url: string;
  docId: string | null;
  variables: Record<string, unknown> | null;
  fbDtsg: string | null;
  lsd: string | null;
}

/**
 * Captures GraphQL requests/responses on a page.
 * Provides utilities to parse Facebook GraphQL responses and replay
 * requests with new cursors for pagination.
 */
export class GraphQLInterceptor {
  private capturedRequests: CapturedRequest[] = [];
  private requestListener: ((req: Request) => void) | null = null;
  private responseListener: ((resp: Response) => void) | null = null;
  private interceptedTexts: string[] = [];

  /** Start listening for GraphQL requests on the page */
  attach(page: Page): void {
    this.capturedRequests = [];
    this.interceptedTexts = [];

    this.requestListener = (req: Request) => {
      const url = req.url();
      if (!url.includes("/api/graphql/") && !url.includes("/graphql/")) return;
      if (req.method() !== "POST") return;
      try {
        const postData = req.postData();
        if (!postData) return;
        const parsed = new URLSearchParams(postData);
        const docId = parsed.get("doc_id");
        const variablesStr = parsed.get("variables");
        const variables = variablesStr ? JSON.parse(variablesStr) : null;
        this.capturedRequests.push({
          url,
          docId,
          variables,
          fbDtsg: parsed.get("fb_dtsg"),
          lsd: parsed.get("lsd"),
        });
      } catch { /* skip */ }
    };

    this.responseListener = async (resp: Response) => {
      const url = resp.url();
      if (!url.includes("/api/graphql/") && !url.includes("/graphql/")) return;
      if (resp.status() !== 200) return;
      try {
        const text = await resp.text();
        this.interceptedTexts.push(text);
      } catch { /* skip */ }
    };

    page.on("request", this.requestListener);
    page.on("response", this.responseListener);
  }

  /** Stop listening */
  detach(page: Page): void {
    if (this.requestListener) page.off("request", this.requestListener);
    if (this.responseListener) page.off("response", this.responseListener);
    this.requestListener = null;
    this.responseListener = null;
  }

  /** Get all intercepted response texts */
  getInterceptedTexts(): string[] {
    return [...this.interceptedTexts];
  }

  /** Drain intercepted texts (returns and clears) */
  drainInterceptedTexts(): string[] {
    const texts = [...this.interceptedTexts];
    this.interceptedTexts = [];
    return texts;
  }

  /** Get the last captured request matching a keyword in variables/docId */
  findCapturedRequest(keyword?: string): CapturedRequest | null {
    if (this.capturedRequests.length === 0) return null;
    if (!keyword) return this.capturedRequests[this.capturedRequests.length - 1];
    for (let i = this.capturedRequests.length - 1; i >= 0; i--) {
      const req = this.capturedRequests[i];
      const varsStr = JSON.stringify(req.variables || {});
      if (varsStr.includes(keyword)) return req;
    }
    return null;
  }

  /**
   * Replay a captured GraphQL request with a new cursor.
   * Uses page.evaluate + fetch to send the request from the browser context
   * (cookies and CSRF tokens are handled automatically).
   */
  async replayWithCursor(
    page: Page,
    captured: CapturedRequest,
    newCursor: string,
    count: number = 50,
  ): Promise<string | null> {
    if (!captured.variables || !captured.docId) return null;

    const newVariables = { ...captured.variables };
    // Update cursor in common locations
    if (newVariables.cursor !== undefined) newVariables.cursor = newCursor;
    if (newVariables.after !== undefined) newVariables.after = newCursor;
    // Nested in feedback or reaction_connection
    if (newVariables.feedback) {
      newVariables.feedback = { ...newVariables.feedback, cursor: newCursor, after: newCursor };
    }
    if (newVariables.count !== undefined) newVariables.count = count;
    if (newVariables.limit !== undefined) newVariables.limit = count;
    if (newVariables.first !== undefined) newVariables.first = count;

    try {
      const result = await page.evaluate(async (params: { url: string; docId: string; variablesStr: string }) => {
        try {
          // Extract fb_dtsg from DOM (multiple possible locations)
          const dtsg = (window as any).__comet_dtsg ||
            document.querySelector('input[name="fb_dtsg"]')?.getAttribute("value") ||
            (document.querySelector('script[type="application/json"]')?.textContent?.match(/"dtsg":\{"token":"([^"]+)"/)?.[1]) ||
            "";

          // Extract lsd token
          const lsd = (window as any).__comet_lsd ||
            document.querySelector('input[name="lsd"]')?.getAttribute("value") ||
            "";

          const body = new URLSearchParams();
          body.append("doc_id", params.docId);
          body.append("variables", params.variablesStr);
          body.append("fb_dtsg", dtsg);
          body.append("lsd", lsd);
          body.append("__a", "1");

          const res = await fetch(params.url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
            credentials: "include",
          });
          return await res.text();
        } catch (e) {
          return "ERROR:" + String(e).substring(0, 100);
        }
      }, {
        url: captured.url,
        docId: captured.docId,
        variablesStr: JSON.stringify(newVariables),
      });

      return result;
    } catch (err) {
      log.debug("GraphQLInterceptor", `replay error: ${String(err).substring(0, 80)}`);
      return null;
    }
  }
}

/**
 * Parse a Facebook GraphQL response text to extract:
 * - Users (from edges/nodes with id + name)
 * - page_info.end_cursor
 * - page_info.has_next_page
 */
export function parseGraphQLResponse(text: string): GraphQLPage {
  let jsonText = text;
  const forIdx = text.indexOf("for (;;);");
  if (forIdx >= 0) jsonText = text.substring(forIdx + 9).trim();

  // Handle multiple JSON objects separated by newlines
  if (jsonText.startsWith("{")) {
    try {
      const data = JSON.parse(jsonText);
      const result = extractUsersAndPageInfo(data);
      return result;
    } catch {
      // Try line-by-line parsing (Facebook sometimes sends multiple responses)
      const lines = jsonText.split("\n").filter(l => l.trim().startsWith("{"));
      const allUsers: GraphQLUser[] = [];
      let endCursor: string | null = null;
      let hasNextPage = false;
      const seen = new Set<string>();
      for (const line of lines) {
        try {
          const partData = JSON.parse(line);
          const partResult = extractUsersAndPageInfo(partData);
          for (const u of partResult.users) {
            if (!seen.has(u.id)) { seen.add(u.id); allUsers.push(u); }
          }
          if (partResult.endCursor) endCursor = partResult.endCursor;
          if (partResult.hasNextPage) hasNextPage = true;
        } catch { /* skip */ }
      }
      return { users: allUsers, endCursor, hasNextPage };
    }
  }

  return { users: [], endCursor: null, hasNextPage: false };
}

function extractUsersAndPageInfo(data: any): GraphQLPage {
  const users: GraphQLUser[] = [];
  const seen = new Set<string>();
  let endCursor: string | null = null;
  let hasNextPage = false;

  // Walk the tree to find connections (edges + page_info)
  walkForConnections(data, users, seen, 10);

  // Find page_info anywhere in the tree
  findPageInfo(data, (cursor, hasNext) => {
    if (cursor) endCursor = cursor;
    if (hasNext) hasNextPage = hasNext;
  }, 8);

  return { users, endCursor, hasNextPage };
}

function walkForConnections(obj: any, users: GraphQLUser[], seen: Set<string>, depth: number): void {
  if (!obj || depth < 0) return;
  if (Array.isArray(obj)) {
    for (const item of obj) walkForConnections(item, users, seen, depth - 1);
    return;
  }
  if (typeof obj !== "object") return;

  // Check if this is a connection (has edges array)
  if (Array.isArray(obj.edges)) {
    for (const edge of obj.edges) {
      const node = edge?.node ?? edge;
      const user = extractUserFromNode(node);
      if (user && !seen.has(user.id)) {
        seen.add(user.id);
        users.push(user);
      }
    }
  }

  // Check if this is a node with user data directly
  if (!Array.isArray(obj.edges)) {
    const user = extractUserFromNode(obj);
    if (user && !seen.has(user.id)) {
      seen.add(user.id);
      users.push(user);
    }
  }

  // Traverse children
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      walkForConnections(obj[key], users, seen, depth - 1);
    }
  }
}

function extractUserFromNode(node: any): GraphQLUser | null {
  if (!node || typeof node !== "object") return null;

  // Try multiple paths for user ID — author/actor first: for comment nodes
  // node.id is the COMMENT's own id, while the user id is nested in author.
  const id = String(
    node.author?.id || node.actor?.id ||
    node.id || node.uid || node.fbid || node.user_id || node.pk || "",
  ).trim();
  if (!id || !/^\d{5,25}$/.test(id)) return null;

  // Try multiple paths for name
  const name = String(
    node.name || node.full_name || node.display_name ||
    node.title?.text || node.text_name ||
    node.profile?.name || node.actor?.name || node.author?.name || ""
  ).trim();
  if (!name || name.length < 2) return null;

  // Build profile URL
  const url = node.url || node.profile_url || node.actor?.url || node.author?.url || "";
  const profileUrl = typeof url === "string" && url.includes("facebook.com")
    ? (url.startsWith("http") ? url : `https://www.facebook.com${url}`)
    : `https://www.facebook.com/profile.php?id=${id}`;

  // Detect reaction type and comment text
  const reaction_type = node.reaction_type || node.reaction || node.reaction_label || undefined;
  const comment_text = node.body?.text || node.text || node.message?.text || undefined;

  return {
    id,
    name: name.substring(0, 200),
    url: profileUrl,
    reaction_type: typeof reaction_type === "string" ? reaction_type : undefined,
    comment_text: typeof comment_text === "string" ? comment_text.substring(0, 300) : undefined,
  };
}

function findPageInfo(obj: any, callback: (cursor: string | null, hasNext: boolean) => void, depth: number): void {
  if (!obj || depth < 0) return;
  if (Array.isArray(obj)) {
    for (const item of obj) findPageInfo(item, callback, depth - 1);
    return;
  }
  if (typeof obj !== "object") return;

  // Check for page_info object
  const pi = obj.page_info || obj.pageInfo || obj.page || obj.paging;
  if (pi && typeof pi === "object") {
    const cursor = pi.end_cursor || pi.cursor || pi.endCursor || pi.after || pi.next_cursor || null;
    const hasNext = pi.has_next_page === true || pi.hasNextPage === true || pi.has_next === true;
    if (cursor || hasNext) callback(typeof cursor === "string" ? cursor : null, hasNext);
  }

  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      findPageInfo(obj[key], callback, depth - 1);
    }
  }
}
