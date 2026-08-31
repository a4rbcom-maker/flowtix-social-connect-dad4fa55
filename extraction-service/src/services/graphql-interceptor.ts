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

/** A captured request correlated with its own response body. This is the
 *  reliable way to pick "the request whose RESPONSE actually carried the
 *  reactor/comment list" — the request metadata alone (doc_id/variables)
 *  cannot distinguish the rich list response from the empty post-payload
 *  response, since FB reuses the same doc_ids for both. */
export interface CapturedPair {
  request: CapturedRequest;
  responseText: string;
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
  private capturedPairs: CapturedPair[] = [];
  private _loggedFirst = false;

  /** Start listening for GraphQL requests on the page */
  attach(page: Page): void {
    this.capturedRequests = [];
    this.interceptedTexts = [];
    this.capturedPairs = [];

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
        // DEBUG
        if (!this._loggedFirst) {
          console.log(`[INTERCEPTOR] First graphql request: docId=${docId}`);
          this._loggedFirst = true;
        }
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
        // Correlate this response with its own request so callers can pick the
        // request whose RESPONSE actually carried the list (not the empty
        // post-payload response that shares the same doc_id).
        try {
          const req = resp.request();
          const postData = req.postData();
          if (req.method() === "POST" && postData) {
            const parsed = new URLSearchParams(postData);
            const variablesStr = parsed.get("variables");
            this.capturedPairs.push({
              request: {
                url: req.url(),
                docId: parsed.get("doc_id"),
                variables: variablesStr ? JSON.parse(variablesStr) : null,
                fbDtsg: parsed.get("fb_dtsg"),
                lsd: parsed.get("lsd"),
              },
              responseText: text,
            });
          }
        } catch { /* correlation best-effort */ }
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

  /** Get every captured request paired with its own response body. */
  getCapturedPairs(): CapturedPair[] {
    return [...this.capturedPairs];
  }

  /** Get all captured GraphQL requests (most recent last). */
  getCapturedRequests(): CapturedRequest[] {
    return [...this.capturedRequests];
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

    const newVariables = { ...captured.variables } as Record<string, any>;
    // Update cursor in common locations
    if (newVariables.cursor !== undefined) newVariables.cursor = newCursor;
    if (newVariables.after !== undefined) newVariables.after = newCursor;
    // Always set a top-level cursor — FB 2026 comment/reaction queries accept it
    // even when the initial captured request omitted it.
    if (newCursor) {
      if (newVariables.cursor === undefined && newVariables.after === undefined) {
        newVariables.cursor = newCursor;
      }
      // Nested in feedback or reaction_connection
      if (newVariables.feedback && typeof newVariables.feedback === "object") {
        newVariables.feedback = { ...newVariables.feedback, cursor: newCursor, after: newCursor };
      }
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

  // Facebook frequently sends multiple concatenated JSON objects (the leading
  // "for (;;);" prefix is followed by one or more JSON blobs). Split them
  // robustly by scanning for top-level objects.
  const blobs = splitJsonBlobs(jsonText);
  if (blobs.length > 0) {
    const allUsers: GraphQLUser[] = [];
    let endCursor: string | null = null;
    let hasNextPage = false;
    const seen = new Set<string>();
    for (const blob of blobs) {
      try {
        const data = JSON.parse(blob);
        const partResult = extractUsersAndPageInfo(data);
        for (const u of partResult.users) {
          if (!seen.has(u.id)) { seen.add(u.id); allUsers.push(u); }
        }
        if (partResult.endCursor) endCursor = partResult.endCursor;
        if (partResult.hasNextPage) hasNextPage = true;
      } catch { /* skip non-JSON blob */ }
    }
    if (allUsers.length > 0 || endCursor !== null || hasNextPage) {
      return { users: allUsers, endCursor, hasNextPage };
    }
  }

  return { users: [], endCursor: null, hasNextPage: false };
}

/** Split a string that may contain one or more concatenated top-level JSON
 *  objects into individual valid JSON strings. */
function splitJsonBlobs(input: string): string[] {
  const blobs: string[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0 && start >= 0) {
        blobs.push(input.substring(start, i + 1));
        start = -1;
      }
    }
  }
  return blobs;
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

  // FB 2026 nests comment authors / reactors inside non-standard arrays:
  //  - comment_action_links[*].author
  //  - reactors (connection or bare array of user nodes)
  //  - top_reactions / supported_reaction_infos (user-ish nodes, but no profile link — skip)
  for (const key of ["comment_action_links", "reactors", "reactor_list", "actors", "participants"]) {
    const arr = obj[key];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        const node = item?.author ?? item?.node ?? item?.actor ?? item;
        const user = extractUserFromNode(node);
        if (user && !seen.has(user.id)) {
          seen.add(user.id);
          users.push(user);
        }
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

  // Skip nodes that are clearly not user entities (posts, comments, photos).
  if (node.__typename && !/User|Profile|Page|Group/.test(node.__typename)) return null;
  // If the node has a post/photo URL, it's not a user.
  const nodeUrl = node.url || node.uri || "";
  if (typeof nodeUrl === "string" && /photo\.php|posts\/|\/videos\/|permalink/.test(nodeUrl) && !/profile\.php/.test(nodeUrl)) {
    return null;
  }
  // Supported reaction infos carry reaction-type IDs (e.g. 613557422527858),
  // not user profiles — skip them.
  if (node.__typename === "SupportedReactionInfo" || node.is_supported_reaction === true) return null;
  // A node with reaction_count / localized_name / a nested `reaction` object /
  // a `color` field is a reaction *type*, not a user.
  if (node.id === "613557422527858") return null; // reaction-type id seen in probe
  if (node.localized_name || node.reaction_count !== undefined || node.reaction_count_reduced) return null;
  if (node.reaction && typeof node.reaction === "object") return null;
  if (typeof node.color === "string" && /^[0-9A-F]{6}$/i.test(node.color)) return null;

  // Try multiple paths for user ID — author/actor first: for comment nodes
  // node.id is the COMMENT's own id, while the user id is nested in author.
  const id = String(
    node.author?.id || node.actor?.id ||
    node.id || node.uid || node.fbid || node.user_id || node.pk ||
    (typeof nodeUrl === "string" ? (nodeUrl.match(/profile\.php\?id=(\d{5,25})/)?.[1] || nodeUrl.match(/facebook\.com\/(\d{5,25})/)?.[1]) : "") || ""
  ).trim();
  if (!id || !/^\d{5,25}$/.test(id)) return null;

  // The id must correspond to a real user profile, not a post/comment fbid.
  // FB post/comment IDs are typically 15-17 digits; user IDs are 10-15 digits.
  // We accept any numeric id that came from a user-shaped node (author/actor/url).
  const fromUserShape = !!(node.author || node.actor || (typeof nodeUrl === "string" && /profile\.php\?id=\d{5,25}/.test(nodeUrl)));
  if (!fromUserShape && /^\d{16,}$/.test(id)) return null; // likely a post/comment fbid

  // Try multiple paths for name. FB 2026 often renders avatar-only nodes with
  // no inline name — fall back to a placeholder rather than dropping the user.
  let name = String(
    node.name || node.full_name || node.display_name ||
    node.title?.text || node.text_name ||
    node.profile?.name || node.actor?.name || node.author?.name ||
    (typeof nodeUrl === "string" ? nodeUrl.match(/facebook\.com\/([a-zA-Z0-9.]+)/i)?.[1] : "") || ""
  ).trim();
  if (!name || name.length < 2) name = "Facebook User";
  if (name.length > 200) name = name.substring(0, 200);

  // Build profile URL
  const url = nodeUrl || node.profile_url || node.actor?.url || node.author?.url || "";
  const profileUrl = typeof url === "string" && url.includes("facebook.com")
    ? (url.startsWith("http") ? url : `https://www.facebook.com${url}`)
    : `https://www.facebook.com/profile.php?id=${id}`;

  // Detect reaction type and comment text
  const reaction_type = node.reaction_type || node.reaction || node.reaction_label || undefined;
  const comment_text = node.body?.text || node.text || node.message?.text || undefined;

  const user: GraphQLUser = {
    id,
    name: name.substring(0, 200),
    url: profileUrl,
    reaction_type: typeof reaction_type === "string" ? reaction_type : undefined,
    comment_text: typeof comment_text === "string" ? comment_text.substring(0, 300) : undefined,
  };
  return user;
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
