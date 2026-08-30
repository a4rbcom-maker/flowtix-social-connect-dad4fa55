import { BaseExtractor, detectAuthState, authStateToMessage, authStateToErrorCode } from "./base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { supabaseService } from "../services/supabase.js";
import type { AuthState, ExtractedMember } from "../types.js";

const log = logger;

interface CapturedContact {
  id: string;
  name: string;
  avatarUrl: string;
}

interface GraphQLRequestInfo {
  url: string;
  postData: string;
}

/**
 * Multi-strategy messenger contacts extractor.
 *
 * 1. GraphQL Response Interception — intercepts ALL GraphQL API responses
 *    and recursively walks the JSON tree to find ANY object with id + name.
 *
 * 2. GraphQL Pagination Replay — captures thread-list GraphQL POST requests,
 *    extracts pagination cursors from responses, then replays the same
 *    request with the new cursor via fetch() to load additional pages.
 *
 * 3. DOM MutationObserver — watches DOM mutations for /messages/t/ links
 *    as a backup for contacts rendered in the virtual scroll list.
 *
 * 4. Aggressive Scrolling — scrolls all overflow containers to trigger
 *    more GraphQL requests from the inbox page.
 */
type MessengerStopReason = "session_rate_limited" | "no_secondary_session" | "source_exhausted" | "max_results_reached";

export class MessengerContactsExtractor extends BaseExtractor {
  // maxExecutionMs is inherited from BaseExtractor (derived from
  // JOB_TIMEOUT_MS config with an enrichment safety margin) — the old fixed
  // 540s override silently capped large inboxes at 9 minutes.
  protected maxConsecutiveEmpty = 3;
  private lastStopReason: MessengerStopReason | null = null;
  private lastProgressTs = 0;
  /** doc_ids captured from LIVE thread-list GraphQL requests during this run
   *  (Task 4) — used before any static doc_id fallback. */
  private capturedThreadDocIds: string[] = [];

  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const pageIdentifier = this.ctx.sourceUrl;
    if (!pageIdentifier) throw new ExtractionError(ErrorCodes.INVALID_INPUT, "No page identifier provided");

    let total = 0;
    let authState: AuthState = "authenticated";
    const seen = new Set<string>();
    const contacts = new Map<string, CapturedContact>();
    const graphqlReqs: GraphQLRequestInfo[] = [];
    let batchListCursor = "";
    let graphqlCount = 0;
    let pageId = "";
    let pageName = "";
    // Audit counters
    let skippedResponses = 0;
    let messengerResponses = 0;
    let duplicatesPrevented = 0;
    const filterCtx = { pageName: "", excludedPages: 0, excludedAutoGen: 0 };

    log.info("MessengerContacts", `=== START === page=${pageIdentifier} budget=${this.timeRemainingSec}s`);
    await this.storeExtractionProgress(0, "navigating", 0);

    // ─── Network interception (set up BEFORE any navigation) ───
    const handleResponse = async (response: any) => {
      const url = response.url();
      if (!url.includes("graphql")) return;
      if (response.status() !== 200) return;

      try {
        const req = response.request();
        const postData = req.postData();
        if (postData && (postData.includes("thread") || postData.includes("Thread") ||
            postData.includes("inbox") || postData.includes("Inbox") ||
            postData.includes("message_thread"))) {
          if (graphqlReqs.length < 100) {
            graphqlReqs.push({ url, postData });
          }
          // Task 4: remember LIVE thread-list doc_ids in arrival order (newest
          // last) — static doc_ids go stale silently when FB ships changes.
          const liveDocId = postData.match(/doc_id[=:](\d+)/)?.[1];
          if (liveDocId && !this.capturedThreadDocIds.includes(liveDocId)) {
            this.capturedThreadDocIds.push(liveDocId);
            if (this.capturedThreadDocIds.length > 20) this.capturedThreadDocIds.shift();
          }
        }

        const text = await response.text();
        if (!text || text.length < 20) return;

        graphqlCount++;

        // FR-1: Only extract contacts from MESSENGER-related responses.
        // Hard-block timeline and profile responses. Check postData + response text.
        const isTimeline = text.includes("timeline_list_feed_units");
        const isProfileSwitch = text.includes("profile_for_intent_switching");
        const isMessenger =
          (postData && (postData.includes("thread") || postData.includes("inbox") || postData.includes("message_thread"))) ||
          (text.includes("retrieve_biz_crm_contact") && text.includes("shared_attributes")) ||
          text.includes("thread_key") ||
          text.includes("last_message");

        let gained = 0;
        if (isTimeline || isProfileSwitch) {
          skippedResponses++;
          if (skippedResponses % 20 === 0) {
            log.info("MessengerContacts", `[graphql #${graphqlCount}] SKIPPED (timeline/profile) doc_id=${postData?.match(/doc_id[=:](\d+)/)?.[1] || "?"}`);
          }
        } else if (isMessenger) {
          messengerResponses++;
          const before = contacts.size;
          this.deepParse(text, contacts, pageId, filterCtx);
          gained = contacts.size - before;
        } else {
          skippedResponses++;
          if (skippedResponses % 20 === 0) {
            log.info("MessengerContacts", `[graphql #${graphqlCount}] SKIPPED (non-messenger) doc_id=${postData?.match(/doc_id[=:](\d+)/)?.[1] || "?"}`);
          }
        }

        // Extract doc_id for identifying the thread-list query
        const docIdMatch = postData?.match(/doc_id[=:](\d+)/);
        const docId = docIdMatch?.[1] || "?";

        if (gained > 0) {
          log.info("MessengerContacts", `[graphql #${graphqlCount}] +${gained} (total ${contacts.size}, ${text.length} chars) doc_id=${docId}`);

          // Search for pagination cursor in this response
          const cursor = this.extractCursor(text);
          const hasNext = text.includes("has_next_page") || text.includes("hasNextPage") || text.includes("has_next");
          if (cursor || hasNext) {
            log.info("MessengerContacts", `[graphql #${graphqlCount}] cursor=${cursor ? cursor.substring(0, 20) + "..." : "none"} has_next=${hasNext}`);

            // If this is a BIG batch (>30 contacts), save cursor for pagination
            if (gained > 30 && cursor && docId !== "?") {
              batchListCursor = cursor;
              log.info("MessengerContacts", `[graphql #${graphqlCount}] BATCH cursor saved for doc_id=${docId}`);
            }
          }
        } else if ((text.includes("thread") || text.includes("Thread")) && text.length > 300) {
          if (graphqlCount <= 60) {
            const idx = text.indexOf("thread");
            const sample = text.substring(Math.max(0, idx - 50), Math.min(text.length, idx + 300)).replace(/[\n\r]/g, " ");
            log.debug("MessengerContacts", `[graphql #${graphqlCount}] thread but 0 parsed (${text.length} chars) near: ...${sample}...`);
          }
        }
      } catch {
        // response body already consumed
      }
    };

    this.page.on("response", handleResponse);

    try {
      // ─── Navigate to page profile ───
      await this.page.goto(`https://www.facebook.com/${pageIdentifier}`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await this.page.waitForTimeout(3000);
      await this.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await this.page.waitForTimeout(2000);

      // Extract page ID and name for self-filtering
      const pageInfo = await this.page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const patterns = [
          /"pageID":"(\d{10,})"/,
          /"page_id":"?(\d{10,})"?/,
          /"entity_id":"(\d{10,})"/,
          /"pageID":\s*"(\d{10,})"/,
          /"id":"(\d{10,})"[^}]{0,30}"name"\s*:\s*"[^"]*"/,
          /pageID=([0-9]{10,})/,
          /asset_id=([0-9]{10,})/,
          /"profile_id":"(\d{10,})"/,
        ];
        let pageId = "";
        for (const p of patterns) {
          const m = html.match(p);
          if (m) { pageId = m[1]; break; }
        }
        if (!pageId) {
          const meta = document.querySelector('meta[property="al:android:url"]')?.getAttribute("content") || "";
          const metaMatch = meta.match(/(\d{10,})/);
          if (metaMatch) pageId = metaMatch[1];
        }
        // Extract page name from OG title or page title
        const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
        const docTitle = document.title || "";
        const title = ogTitle || docTitle;
        const nameMatch = title.match(/^(.*?)(?:\s*[-–—|]\s*Facebook)?$/);
        const pageName = nameMatch?.[1]?.trim() || title.split(/\s*[-–—|]\s*/)[0]?.trim() || "";
        return { pageId, pageName };
      });
      pageId = pageInfo.pageId;
      pageName = filterCtx.pageName = pageInfo.pageName;
      log.info("MessengerContacts", `pageId=${pageId || "?"} pageName=${pageName || "?"}`);
      if (pageId) contacts.delete(`msg_${pageId}`);

      // Click Switch/Manage
      await this.page.evaluate(() => {
        const els = document.querySelectorAll<HTMLElement>('[role="button"], a, button, span');
        for (const el of els) {
          const t = el.innerText?.trim() || "";
          if (t === "Switch" || t === "تبديل" || t === "إدارة" || t === "Manage" || t.includes("Switch to")) {
            (el as HTMLElement).click();
            return;
          }
        }
      });
      await this.page.waitForTimeout(3000);
      await this.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

      const html = await this.page.content();
      authState = detectAuthState(html, this.page.url());
      log.info("MessengerContacts", `auth=${authState} url=${this.page.url()}`);
      if (authState === "needs_login" || authState === "restricted") {
        throw new ExtractionError(authStateToErrorCode(authState), authStateToMessage(authState));
      }

      // ─── Navigate to inbox — try all URLs to maximize GraphQL capture ───
      const inboxUrls = [
        `https://www.facebook.com/${pageIdentifier}/inbox/`,
        `https://www.facebook.com/${pageIdentifier}/messages/`,
        `https://www.facebook.com/messages/?page_id=${pageId}`,
      ];

      for (const url of inboxUrls) {
        if (this.shouldStop) break;
        log.info("MessengerContacts", `navigate: ${url}`);
        await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await this.page.waitForTimeout(5000);
        await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(5000);

        const finalUrl = this.page.url();
        log.info("MessengerContacts", `landed: ${finalUrl} graphql=${graphqlCount} contacts=${contacts.size}`);

        // Try all URLs — we want to maximize GraphQL capture, don't break early
      }

      // Wait for late GraphQL responses
      await this.page.waitForTimeout(5000);
      log.info("MessengerContacts", `initial: ${contacts.size} contacts, ${graphqlCount} graphql, ${graphqlReqs.length} thread reqs`);

      // ─── Direct API: Force Meta Business Suite inbox to load via GraphQL ───
      log.info("MessengerContacts", `calling bootstrapAndPaginate`);
      await this.bootstrapAndPaginate(pageId, contacts, seen, batchListCursor);

      // ─── Inject DOM MutationObserver as backup ───
      await this.injectDOMObserver();

      // ─── Flush initial contacts ───
      total += await this.flushContacts(contacts, seen);

      // ─── Phase 0: Scroll the current inbox page to trigger lazy loading ───
      // The Meta Business Suite inbox loads conversations via GraphQL as you scroll
      if (contacts.size > 0 && contacts.size < this.ctx.maxResults && !this.shouldStop) {
        log.info("MessengerContacts", `scrolling inbox for lazy-loaded conversations`);
        let scrollCycle = 0;
        let scrollEmpty = 0;

        while (scrollEmpty < 3 && contacts.size < this.ctx.maxResults && !this.shouldStop) {
          if (await this.checkCanceled()) break;
          scrollCycle++;
          const before = contacts.size;
          const beforeGql = graphqlCount;
          const workStart = Date.now();

          while (Date.now() - workStart < 25_000 && !this.shouldStop) {
            await this.scrollAggressively();
            await this.page.waitForTimeout(300);
          }

          await this.collectDOMContacts(contacts);
          total += await this.flushContacts(contacts, seen);

          const gainedContacts = contacts.size - before;
          const gainedGql = graphqlCount - beforeGql;

          if (gainedContacts > 0 || gainedGql > 0) {
            scrollEmpty = 0;
            log.info("MessengerContacts", `inbox-scroll ${scrollCycle}: +${gainedContacts} contacts +${gainedGql} gql (total ${contacts.size} stored ${total} ${this.runtimeSec}s)`);
          } else {
            scrollEmpty++;
            log.info("MessengerContacts", `inbox-scroll EMPTY ${scrollEmpty}/3 (total ${contacts.size} ${this.runtimeSec}s)`);
          }

          if (scrollEmpty < 3 && contacts.size < this.ctx.maxResults && !this.shouldStop) {
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      }

      // ─── Phase 1: Flush remaining contacts (pagination handled by bootstrapAndPaginate) ───
      total += await this.flushContacts(contacts, seen);

      // ─── Phase 2: mbasic.facebook.com — RETIRED (probe 2026-08-30: mbasic
      // now redirects to www.facebook.com, serves no conversation list, and
      // the old parse could inject the account's last-open thread as a junk
      // contact). Do not re-add without a fresh probe showing a real list. ───

      // ─── Phase 3: Scroll loop (last resort, triggers more GraphQL) ───
      if (contacts.size < this.ctx.maxResults && !this.shouldStop) {
        log.info("MessengerContacts", `starting scroll loop`);
        let cycle = 0;
        let consecutiveEmpty = 0;

        while (!this.shouldStop && contacts.size < this.ctx.maxResults && consecutiveEmpty < this.maxConsecutiveEmpty) {
          if (await this.checkCanceled()) break;
          cycle++;

          const before = contacts.size;
          const beforeGql = graphqlCount;
          const workStart = Date.now();

          while (Date.now() - workStart < 30_000 && !this.shouldStop) {
            await this.scrollAggressively();
            await this.page.waitForTimeout(300);
          }

          await this.collectDOMContacts(contacts);
          total += await this.flushContacts(contacts, seen);

          const gainedContacts = contacts.size - before;
          const gainedGql = graphqlCount - beforeGql;

          if (gainedContacts > 0 || gainedGql > 0) {
            consecutiveEmpty = 0;
            log.info("MessengerContacts", `scroll ${cycle}: +${gainedContacts} contacts +${gainedGql} gql (total ${contacts.size} stored ${total} ${this.runtimeSec}s)`);
          } else {
            consecutiveEmpty++;
            log.info("MessengerContacts", `EMPTY ${cycle} (${consecutiveEmpty}/${this.maxConsecutiveEmpty}) contacts=${contacts.size} ${this.runtimeSec}s`);
          }

          if (!this.shouldStop && consecutiveEmpty < this.maxConsecutiveEmpty && contacts.size < this.ctx.maxResults) {
            await new Promise((r) => setTimeout(r, 5000));
          }
        }
      }

      // ─── Final flush ───
      await this.collectDOMContacts(contacts);
      total += await this.flushContacts(contacts, seen);

      await this.page.evaluate(() => (window as any).__observer?.disconnect()).catch(() => {});
      this.page.off("response", handleResponse);

      if (this.lastStopReason === null && total >= this.ctx.maxResults) {
        this.lastStopReason = "max_results_reached";
      }
      await this.storeExtractionProgress(total, "completed", 0, this.lastStopReason);

      log.info("MessengerContacts", `=== DONE === total=${total} graphql=${graphqlCount} captured=${contacts.size} time=${this.runtimeSec}s stopReason=${this.lastStopReason ?? "null"}`);
      log.info("MessengerContacts", `=== AUDIT: total=${total}, messengerResponses=${messengerResponses}, skippedResponses=${skippedResponses}, excludedPages=${filterCtx.excludedPages}, excludedAutoGen=${filterCtx.excludedAutoGen}, duplicatesPrevented=${duplicatesPrevented}`);
      return { extracted: total, done: true, authState };
    } catch (err) {
      await this.page.evaluate(() => (window as any).__observer?.disconnect()).catch(() => {});
      this.page.off("response", handleResponse);
      log.error("MessengerContacts", `error: ${String(err)}`);
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════
  // GraphQL Deep Recursive Parsing
  // ═══════════════════════════════════════════════════

  /**
   * Parse a GraphQL response (which may be single JSON, newline-separated
   * batch JSON, or concatenated JSON objects) and extract contacts.
   */
  private deepParse(text: string, results: Map<string, CapturedContact>, excludeId: string, filterCtx: { pageName: string; excludedPages: number; excludedAutoGen: number }): void {
    const clean = text.replace(/^for\s*\(\s*;;\s*\)\s*;?/, "").trim();
    if (!clean.startsWith("{")) return;

    const objects: any[] = [];

    // Try single JSON
    try {
      objects.push(JSON.parse(clean));
    } catch {
      // Batch format: concatenated JSON objects — parse by tracking brace depth
      let depth = 0;
      let start = 0;
      let inStr = false;
      let esc = false;

      for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (esc) { esc = false; continue; }
        if (ch === "\\") { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === "{") {
          if (depth === 0) start = i;
          depth++;
        } else if (ch === "}") {
          depth--;
          if (depth === 0) {
            try {
              objects.push(JSON.parse(clean.substring(start, i + 1)));
            } catch {}
          }
        }
      }
    }

    for (const obj of objects) {
      this.walkJSON(obj, results, excludeId, 0, filterCtx);
    }
  }

  /**
   * Recursively walk a JSON object tree and collect anything that looks
   * like a contact (has numeric id + name string).
   */
  private walkJSON(obj: any, results: Map<string, CapturedContact>, excludeId: string, depth: number, filterCtx: { pageName: string; excludedPages: number; excludedAutoGen: number }): void {
    if (!obj || typeof obj !== "object" || depth > 25) return;

    // Check if this object is a contact/profile
    if (obj.id != null && obj.name && typeof obj.name === "string") {
      const id = String(obj.id);
      if (/^\d{5,}$/.test(id) && id !== excludeId && obj.name.length >= 2 && obj.name.length <= 100) {
        const typename = obj.__typename || "";
        const actorType = obj.__isMessagingActor || "";
        const actorTypeLower = String(actorType).toLowerCase();
        const name = obj.name;
        const nameLower = name.toLowerCase();

        // FR-3: Filter out non-user entities by __typename
        const nonUserTypes = new Set([
          "Page", "Business", "Organization", "Store", "Bot", "App",
          "AIAssistant", "Game", "Group", "Event", "Application",
        ]);

        // FR-3: Filter by __isMessagingActor
        // FR-4: Auto-generated name pattern
        const autoGenPattern = /^(Adventurous|Playful|Shiny|Happy|Sleepy|Crazy|Funny|Silly|Cool|Super)[A-Z][a-z]+\d+$/;
        const isAutoGen = autoGenPattern.test(name) || nameLower === "wa not available" || nameLower.startsWith("ig ") || name.length < 3;

        // FR-3: Keyword-based page/business detection (only when __typename is not "User")
        const excludedKeywords = [
          "news", "store", "school", "university", "restaurant", "cafe",
          "airline", "entertainment", "recruiting", "foundation", "magazine",
          "institution", "agency", "consulting", "shipping", "wedding",
          "nursery", "academy", "journal", "boutique", "fashion",
        ];
        const hasExcludedKeyword = typename !== "User" && excludedKeywords.some(kw => nameLower.includes(kw));

        // FR-2: Self-reference — exclude page name
        const isSelfRef = filterCtx.pageName && name === filterCtx.pageName;

        const shouldExclude =
          nonUserTypes.has(typename) ||
          actorTypeLower === "page" || actorTypeLower === "bot" || actorTypeLower === "business" ||
          (typeof actorType === "string" && actorType === "Page") ||
          isAutoGen ||
          hasExcludedKeyword ||
          isSelfRef;

        if (shouldExclude) {
          if (isAutoGen) filterCtx.excludedAutoGen++;
          else filterCtx.excludedPages++;
          return;
        }

        const key = `msg_${id}`;
        if (!results.has(key)) {
          const avatar =
            obj.big_image_src?.uri ||
            obj.image?.uri ||
            obj.profile_pic?.uri ||
            obj.profilePicture?.uri ||
            (typeof obj.big_image_src === "string" ? obj.big_image_src : "") ||
            "";
          results.set(key, { id: key, name, avatarUrl: avatar });
        }
      }
    }

    // Recurse into children
    if (Array.isArray(obj)) {
      for (const item of obj) this.walkJSON(item, results, excludeId, depth + 1, filterCtx);
    } else {
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val && typeof val === "object") {
          this.walkJSON(val, results, excludeId, depth + 1, filterCtx);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // Token Extraction & Request Building
  // ═══════════════════════════════════════════════════

  private async extractTokens(): Promise<{ fbDtsg: string; lsd: string; userId: string }> {
    return await this.page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const w = window as any;
      const extract = (patterns: RegExp[]): string => {
        for (const p of patterns) { const m = html.match(p); if (m?.[1]) return m[1]; }
        return "";
      };
      return {
        fbDtsg: w.DTSGInitData?.token || extract([/"token":"([A-Za-z0-9_-]{20,})"/]),
        lsd: extract([/"LSD"[^}]*"token":"([^"]+)"/, /"lsd":"([^"]+)"/]),
        userId: extract([/"userID":"(\d+)"/, /"user_id":"(\d+)"/, /c_user=(\d+)/, /"account_id":"(\d+)"/]) || (w.Env?.user || w.__user || ""),
      };
    }).catch(() => ({ fbDtsg: "", lsd: "", userId: "" }));
  }

  private buildGraphQLBody(docId: string, variables: Record<string, any>,
    tokens: { fbDtsg: string; lsd: string; userId: string }, pageIdNum: string): string {
    const body = new URLSearchParams();
    body.set("av", pageIdNum);
    body.set("__user", tokens.userId || pageIdNum);
    body.set("__a", "1");
    body.set("__req", Math.random().toString(36).substring(2, 8));
    body.set("doc_id", docId);
    body.set("variables", JSON.stringify(variables));
    if (tokens.fbDtsg) body.set("fb_dtsg", tokens.fbDtsg);
    if (tokens.lsd) body.set("lsd", tokens.lsd);
    return body.toString();
  }

  private logStopReason(reason: string, details: string): void {
    log.info("MessengerContacts", `=== STOPPED: ${reason} | ${details} | time=${this.runtimeSec}s`);
    if (this.lastStopReason !== null) return;

    if (reason === "max_results_or_cancelled") {
      this.lastStopReason = "max_results_reached";
    } else if (reason === "end_of_list" || reason === "no_cursor" || reason === "cursor_stall") {
      this.lastStopReason = "source_exhausted";
    } else if (reason === "request_failed") {
      this.lastStopReason = this.totalSessions > 1 ? "session_rate_limited" : "no_secondary_session";
    }
  }

  private async storeExtractionProgress(
    discovered: number,
    phase: "navigating" | "scrolling" | "xhr_replay" | "completed",
    phaseCycle: number,
    stopReason?: MessengerStopReason | null,
  ): Promise<void> {
    const now = Date.now();
    if (phase !== "navigating" && phase !== "completed" && now - this.lastProgressTs < 10_000) {
      return;
    }
    this.lastProgressTs = now;

    const progress: Record<string, unknown> = {
      discovered,
      processed: discovered,
      phase,
      phase_cycle: phaseCycle,
      last_update: new Date().toISOString(),
    };
    if (stopReason !== undefined) progress.stop_reason = stopReason;

    try {
      const job = await supabaseService.getJob(this.ctx.jobId).catch(() => null);
      const existingProgress = (job?.progress || {}) as Record<string, unknown>;
      await supabaseService.storeProgress(this.ctx.jobId, { ...existingProgress, ...progress });
    } catch (err) {
      log.debug("MessengerContacts", `storeProgress failed: ${String(err)}`);
    }
  }

  // ═══════════════════════════════════════════════════
  // Bootstrap & Paginate (primary extraction engine)
  // ═══════════════════════════════════════════════════

  /**
   * FR-5: Resolve the real Business Suite mailbox id for the selected page
   * at runtime. The mailbox is NEVER hardcoded — every account/page pair has
   * its own mailbox, and using a foreign one cross-contaminates results.
   *
   * Strategy:
   *   1. Navigate to business.facebook.com latest inbox for the page and
   *      read the resolved ids Facebook itself puts in the final URL.
   *   2. Read a live mailbox_id / page_id token from the page HTML.
   *   3. A redirect away from the inbox means this page seed is unusable —
   *      give up and let the caller skip the GraphQL engine (no guessing).
   *
   * Returns "" when nothing can be resolved — the caller must then skip the
   * GraphQL engine instead of guessing.
   */
  private async resolveMailboxId(pageId: string): Promise<string> {
    if (!pageId) {
      log.warn("MessengerContacts", `[resolveMailbox] no page id — cannot resolve mailbox`);
      return "";
    }

    const bizUrl = `https://business.facebook.com/latest/inbox/all?asset_id=${pageId}&asset_id_list=[%22${pageId}%22]&mailbox_id=${pageId}`;
    try {
      await this.page.goto(bizUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.page.waitForTimeout(5000);
      await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await this.page.waitForTimeout(2000);
    } catch (err) {
      log.warn("MessengerContacts", `[resolveMailbox] nav failed: ${String(err).substring(0, 120)}`);
    }

    const finalUrl = this.page.url();
    const urlAsset = finalUrl.match(/asset_id=(\d{10,})/)?.[1] || "";
    const urlMailbox = finalUrl.match(/mailbox_id=(\d{10,})/)?.[1] || "";

    const htmlIds = await this.page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const grab = (re: RegExp): string => html.match(re)?.[1] || "";
      // Redirect to business picker/home without an asset in the URL means
      // this session cannot access the page's inbox.
      if (/business\.facebook\.com\/(overview|home|select|latest\/redirect)/.test(location.href) && !location.href.includes("asset_id=")) {
        return { asset: "", mailbox: "", redirect: true };
      }
      return {
        asset: grab(/"(?:asset_id|page_id|pageID)"\s*:\s*"?(\d{10,})"?/),
        mailbox: grab(/"(?:mailbox_id|mailboxID|viewer_mailbox_id)"\s*:\s*"?(\d{10,})"?/),
        redirect: false,
      };
    }).catch(() => ({ asset: "", mailbox: "", redirect: true }));

    if (htmlIds.redirect) {
      log.info("MessengerContacts", `[resolveMailbox] redirected away (no inbox access for page=${pageId})`);
      return "";
    }

    const mailbox = urlMailbox || htmlIds.mailbox || urlAsset || htmlIds.asset || "";
    if (mailbox) {
      log.info("MessengerContacts", `[resolveMailbox] resolved mailbox=${mailbox} (url_asset=${urlAsset || "-"} url_mailbox=${urlMailbox || "-"} html_asset=${htmlIds.asset || "-"} html_mailbox=${htmlIds.mailbox || "-"})`);
      return mailbox;
    }

    log.warn("MessengerContacts", `[resolveMailbox] could not resolve mailbox for page=${pageId}`);
    return "";
  }

  private async bootstrapAndPaginate(
    pageId: string,
    contacts: Map<string, CapturedContact>,
    seen: Set<string>,
    batchListCursor: string,
  ): Promise<void> {
    const filterCtx = { pageName: "", excludedPages: 0, excludedAutoGen: 0 }; // direct API calls don't track these

    // FR-5: Derive the mailbox for the SELECTED page at runtime. No hardcoded
    // mailbox/page fallbacks — extraction must never cross pages or accounts.
    const mailboxId = await this.resolveMailboxId(pageId);
    if (!mailboxId) {
      this.logStopReason("no_working_pattern", `mailbox not resolvable for page=${pageId || "?"} — skipping GraphQL engine (no hardcoded fallback)`);
      return;
    }
    const pageIdNum = pageId;
    log.info("MessengerContacts", `[bootstrap] resolved mailbox=${mailboxId} for page=${pageIdNum}`);

    // Step 1: Try extracting tokens from current page first (faster)
    let tokens = await this.extractTokens();
    if (!tokens.fbDtsg) {
      // Fall back to www.facebook.com which always has DTSGInitData
      log.info("MessengerContacts", `[bootstrap] fb_dtsg not found on current page, trying www.facebook.com`);
      await this.page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.page.waitForTimeout(4000);
      tokens = await this.extractTokens();
    }

    log.info("MessengerContacts", `[bootstrap] tokens: fb_dtsg=${tokens.fbDtsg ? "yes" : "no"} user=${tokens.userId || "?"}`);

    if (!tokens.fbDtsg) {
      this.logStopReason("no_fb_dtsg", "cannot build GraphQL requests");
      return;
    }

    // Step 2: Navigate to business inbox to get cookies/context + trigger auto-load
    const bizUrl = `https://business.facebook.com/latest/inbox/all?asset_id=${mailboxId}&mailbox_id=${mailboxId}`;
    log.info("MessengerContacts", `[bootstrap] navigating to ${bizUrl}`);
    await this.page.goto(bizUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await this.page.waitForTimeout(5000);
    await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(3000);

    log.info("MessengerContacts", `[bootstrap] loaded: ${this.page.url()} contacts=${contacts.size}`);

    if (contacts.size >= this.ctx.maxResults || this.shouldStop) {
      this.logStopReason("max_results_or_cancelled", `contacts=${contacts.size}`);
      return;
    }

    // Task 4: prefer LIVE doc_ids captured from real thread-list requests this
    // run; the static id is only a last-resort fallback.
    const workingDocId = this.capturedThreadDocIds[this.capturedThreadDocIds.length - 1] || "27615938851434506";
    log.info("MessengerContacts", `[bootstrap] doc_id=${workingDocId} (source=${this.capturedThreadDocIds.length ? "live-captured" : "static-fallback"}, captured=${this.capturedThreadDocIds.length})`);
    let workingVars: Record<string, any> = { mailbox_id: mailboxId, thread_type: "FB_MESSAGE", count: 200 };
    let cursor = batchListCursor || "";

    if (!cursor) {
      log.info("MessengerContacts", `[bootstrap] no batchListCursor — searching for working pattern`);
      const varPatterns: Record<string, any>[] = [
        { cursor: null, mailbox_id: mailboxId, thread_type: "FB_MESSAGE", count: 200 },
        { cursor: null, mailbox_id: mailboxId, thread_type: "FB_MESSAGE", first: 200 },
        { cursor: null, mailbox_id: mailboxId, page_size: 200 },
        { cursor: null, id: mailboxId, thread_type: "FB_MESSAGE", count: 200 },
        { cursor: null, id: mailboxId, first: 200 },
        { cursor: null, mailboxID: mailboxId, thread_type: "FB_MESSAGE", count: 200 },
        { cursor: null, page_id: pageIdNum, thread_type: "FB_MESSAGE", count: 200 },
        { cursor: null, folder: "INBOX", page_id: pageIdNum, count: 200 },
      ];
      for (const vars of varPatterns) {
        if (this.shouldStop) break;
        const body = this.buildGraphQLBody(workingDocId, vars, tokens, pageIdNum);
        const result = await this.sendGraphQL(body);
        if (!result.ok || result.text.length < 20) continue;
        const before = contacts.size;
        this.deepParse(result.text, contacts, pageIdNum, filterCtx);
        const gained = contacts.size - before;
        const c = this.extractCursor(result.text);
        log.info("MessengerContacts", `[bootstrap] vars=${JSON.stringify(vars).substring(0, 80)} → +${gained} cursor=${c ? "yes" : "no"} (${result.text.length} chars)`);
        if (gained > 0 || (c && result.text.length > 10000)) { workingVars = vars; cursor = c || ""; log.info("MessengerContacts", `[bootstrap] FOUND working pattern`); break; }
      }
      if (!cursor) { this.logStopReason("no_working_pattern", `tried ${varPatterns.length} patterns`); return; }
    } else {
      log.info("MessengerContacts", `[bootstrap] using batchListCursor=${cursor.substring(0, 20)}...`);
    }

    let pages = 0;
    let emptyCycles = 0;
    let prevCursor = "";
    while (!this.shouldStop && contacts.size < this.ctx.maxResults) {
      if (await this.checkCanceled()) break;
      pages++;
      const vars = { ...workingVars, cursor };
      vars.cursor = cursor;
      const body = this.buildGraphQLBody(workingDocId, vars, tokens, pageIdNum);
      const result = await this.sendGraphQL(body);
      if (!result.ok || result.text.length < 20) {
        this.logStopReason("request_failed", `page=${pages} status=${result.status}`);
        break;
      }
      const before = contacts.size;
      this.deepParse(result.text, contacts, pageIdNum, filterCtx);
      const gained = contacts.size - before;
      const nextCursor = this.extractCursor(result.text);
      log.info("MessengerContacts", `[paginate] page ${pages}: +${gained} (total=${contacts.size}, ${result.text.length} chars) nextCursor=${nextCursor ? nextCursor.substring(0, 20) + "..." : "no"}`);
      if (gained > 0) { emptyCycles = 0; await this.flushContacts(contacts, seen); }

      // Progress update (debounced: max every 15s)
      if (pages === 1 || pages % 3 === 0) {
        await this.storeExtractionProgress(contacts.size, "xhr_replay", pages);
      }
      else emptyCycles++;
      if (emptyCycles >= 3) { this.logStopReason("end_of_list", `emptyCycles=${emptyCycles}`); break; }
      if (!nextCursor) { this.logStopReason("no_cursor", `page=${pages}`); break; }
      if (nextCursor === cursor || nextCursor === prevCursor) { this.logStopReason("cursor_stall", `page=${pages}`); break; }
      prevCursor = cursor;
      cursor = nextCursor;
      await this.page.waitForTimeout(1500);
      if (this.timeRemainingSec < 60) { this.logStopReason("timeout_approaching", `page=${pages}`); break; }
    }
    log.info("MessengerContacts", `[bootstrap] done: ${contacts.size} contacts across ${pages} pages`);
  }

  private async sendGraphQL(body: string): Promise<{ ok: boolean; status: number; text: string }> {
    try {
      return await this.page.evaluate(async (params: { body: string }) => {
        const resp = await fetch("/api/graphql/", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.body, credentials: "include",
        });
        return { ok: resp.ok, status: resp.status, text: await resp.text() };
      }, { body });
    } catch (e: any) { return { ok: false, status: 0, text: e?.message || "" }; }
  }

  private extractCursor(text: string): string {
    const patterns = [
      /"page_info"\s*:\s*\{[^}]*"end_cursor"\s*:\s*"([^"]{4,})"/,  // page_info-based GraphQL
      /"end_cursor"\s*:\s*"([^"]{4,})"/,   // generic end_cursor (NEXT page)
      /"paging"\s*:\s*\{[^}]*"cursors"\s*:\s*\{[^}]*"after"\s*:\s*"([^"]{4,})"/,
      /"has_next_page"\s*:\s*true[^}]*"end_cursor"\s*:\s*"([^"]{4,})"/,
      /"after"\s*:\s*"(AQ[A-Za-z0-9_-]{10,})"/,   // specific after cursor pattern
      /"next"\s*:\s*"[^"]*cursor=([^"&]+)/,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1] && m[1] !== "null") return m[1];
    }
    return "";
  }

  // ═══════════════════════════════════════════════════
  // mbasic.facebook.com — RETIRED (probe 2026-08-30: permanent redirect to
  // www, no conversation list; parse could inject junk contacts). Kept as a
  // comment only; delete the block after one stable release.
  // ═══════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════
  // DOM MutationObserver
  // ═══════════════════════════════════════════════════

  private async injectDOMObserver(): Promise<void> {
    await this.page.evaluate(() => {
      (window as any).__domContacts = new Map();

      function extractFromEl(root: HTMLElement | Document) {
        const links = (root as HTMLElement).querySelectorAll?.('a[href*="/messages/t/"]') || [];
        for (const link of Array.from(links)) {
          const href = link.getAttribute("href") || "";
          const match = href.match(/\/messages\/t\/(\d+)/);
          if (!match) continue;
          const id = match[1];
          if ((window as any).__domContacts.has(id)) continue;

          let name = "";
          let parent: HTMLElement | null = link as HTMLElement;
          for (let d = 0; d < 5; d++) {
            parent = parent?.parentElement;
            if (!parent) break;
            for (const s of parent.querySelectorAll("span, strong, h3, h4")) {
              const t = (s as HTMLElement).innerText?.trim() || "";
              if (t.length >= 2 && t.length <= 60 && !/^\d+$/.test(t) &&
                  !["الوسائط", "متصل", "Active", "typing", "يكتب"].some(x => t.includes(x))) {
                name = t.split("\n")[0];
                break;
              }
            }
            if (name) break;
          }
          if (!name || name.length < 2) continue;

          let avatar = "";
          const container = link.closest("div, li, [role='listitem']") || link.parentElement;
          if (container) {
            for (const img of container.querySelectorAll("img")) {
              const src = (img as HTMLImageElement).src || "";
              if (src.includes("fbcdn") || src.includes("scontent")) { avatar = src; break; }
            }
          }
          (window as any).__domContacts.set(id, { id: `msg_${id}`, name, avatarUrl: avatar });
        }
      }

      extractFromEl(document.body);

      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of Array.from(m.addedNodes)) {
            if (node.nodeType === 1) extractFromEl(node as HTMLElement);
          }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      (window as any).__observer = obs;
    }).catch(() => {});
  }

  private async collectDOMContacts(contacts: Map<string, CapturedContact>): Promise<void> {
    const domContacts: CapturedContact[] = await this.page.evaluate(() => {
      const result: CapturedContact[] = [];
      const domMap = (window as any).__domContacts;
      if (domMap) {
        for (const [, val] of domMap) result.push(val);
      }
      return result;
    }).catch(() => []);

    for (const dc of domContacts) {
      if (!contacts.has(dc.id)) contacts.set(dc.id, dc);
    }
  }

  // ═══════════════════════════════════════════════════
  // Scrolling
  // ═══════════════════════════════════════════════════

  private async scrollAggressively(): Promise<void> {
    await this.page.evaluate(() => {
      const selectors = [
        '[aria-label*="Conversation"]', '[aria-label*="convers"]', '[aria-label*="محادث"]',
        '[role="navigation"]', '[role="main"] > div > div',
        'div[style*="overflow-y: auto"]', 'div[style*="overflow-y:auto"]',
      ];
      const scrolled: Element[] = [];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => {
          const h = el as HTMLElement;
          if (h.scrollHeight > h.clientHeight + 50 && h.clientHeight > 100) {
            h.scrollTop = h.scrollHeight; scrolled.push(h);
          }
        });
      }
      const all = document.querySelectorAll("*");
      for (const el of all) {
        if (scrolled.includes(el)) continue;
        const h = el as HTMLElement;
        if (h.scrollHeight > h.clientHeight + 100 && h.clientHeight > 50) {
          const s = getComputedStyle(h);
          if (s.overflowY === "auto" || s.overflowY === "scroll") h.scrollTop = h.scrollHeight;
        }
      }
    }).catch(() => {});

    await this.page.mouse.move(400, 600).catch(() => {});
    await this.page.mouse.wheel(0, 1500).catch(() => {});
    await this.page.waitForTimeout(100);

    await this.page.keyboard.press("End").catch(() => {});
    await this.page.keyboard.press("PageDown").catch(() => {});
    for (let k = 0; k < 5; k++) await this.page.keyboard.press("ArrowDown").catch(() => {});
  }

  // ═══════════════════════════════════════════════════
  // Flush to DB
  // ═══════════════════════════════════════════════════

  private async flushContacts(contacts: Map<string, CapturedContact>, seen: Set<string>): Promise<number> {
    const batch: ExtractedMember[] = [];
    for (const [, c] of contacts) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        batch.push({ fb_id: c.id, name: c.name, profile_url: "", avatar_url: c.avatarUrl || undefined, type: "messenger_contact" });
      }
    }
    if (batch.length === 0) return 0;
    return await this.processBatch(batch, "messenger_contact");
  }
}
