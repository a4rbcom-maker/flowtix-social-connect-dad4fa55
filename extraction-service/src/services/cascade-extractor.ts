import type { Page } from "playwright";
import { logger } from "../logger.js";
import { supabaseService } from "./supabase.js";
import { enrichmentService } from "./enrichment-service.js";
import { parsePageId } from "../extractors/base.js";
import { ProfileVisitor } from "./profile-visitor.js";
import { extractDomUsers } from "./dom-extractor.js";
import * as fs from "fs";
import * as path from "path";

export interface CascadeOptions {
  jobId: string;
  workspaceId: string;
  sourceUrl: string;
  maxResults: number;
  postLimit: number;
  maxReactionsPerPost: number;
  maxCommentersPerPost: number;
  sessionIds: string[];
  sessionCookies: Map<string, any[]>;
  skipDuplicates: boolean;
  enableEnrichment: boolean;
  existingPages?: { sessionId: string; page: Page }[];
}

export interface CascadeResult {
  totalExtracted: number;
  totalEnriched: number;
  uniqueUsers: number;
  postsProcessed: number;
  stopReason: "completed" | "max_results" | "source_exhausted" | "rate_limited" | "session_expired" | "error";
  pageInfo: { id: string; name: string; totalFollowers: number | null };
  checkpointPath: string;
}

interface Checkpoint {
  collectedUserIds: string[];
  totalStored: number;
  lastSavedAt: string;
}

const log = logger;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function extractPageFollowersCascade(opts: CascadeOptions): Promise<CascadeResult> {
  const pageIdentifier = parsePageId(opts.sourceUrl) || opts.sourceUrl;
  const checkpointDir = path.join(process.cwd(), "checkpoints");
  if (!fs.existsSync(checkpointDir)) fs.mkdirSync(checkpointDir, { recursive: true });
  const checkpointPath = path.join(checkpointDir, `${opts.jobId}.json`);

  let checkpoint: Checkpoint = loadCheckpoint(checkpointPath);
  let totalStored = checkpoint.totalStored;

  log.info("Cascade", `========================================`);
  log.info("Cascade", `Profile Visitor Extraction`);
  log.info("Cascade", `jobId=${opts.jobId} page=${pageIdentifier} max=${opts.maxResults}`);

  if (!opts.existingPages || opts.existingPages.length === 0) {
    return { totalExtracted: 0, totalEnriched: 0, uniqueUsers: 0, postsProcessed: 0, stopReason: "error", pageInfo: { id: pageIdentifier, name: "", totalFollowers: null }, checkpointPath };
  }

  const page = opts.existingPages[0].page;

  try {
    // ===== Step 1: Get seed users from DOM (feed + followers page) =====
    log.info("Cascade", `Step 1: DOM extraction for seed users...`);

    // First go to followers page briefly
    await page.goto(`https://www.facebook.com/${pageIdentifier}/followers/`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(5000);

    // Then go to main page for feed extraction
    await page.goto(`https://www.facebook.com/${pageIdentifier}`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(4000);

    const seedUsers = await extractDomUsers(page, pageIdentifier, { maxRounds: 80, maxUsers: 500, scrollMs: 1000 });
    log.info("Cascade", `Seed users found: ${seedUsers.length}`);

    if (seedUsers.length === 0) {
      log.warn("Cascade", "no seed users — nothing to visit");
      return { totalExtracted: 0, totalEnriched: 0, uniqueUsers: 0, postsProcessed: 0, stopReason: "source_exhausted", pageInfo: { id: pageIdentifier, name: "", totalFollowers: null }, checkpointPath };
    }

    // ===== Step 2: Profile Visitor — visit each seed + discover more =====
    log.info("Cascade", `Step 2: Profile visiting (${seedUsers.length} seeds)...`);

    const batchBuffer: any[] = [];
    const BATCH_FLUSH = 25;
    let stopReason: CascadeResult["stopReason"] = "completed";
    let totalEnriched = 0;

    const visitor = new ProfileVisitor(page, {
      maxProfiles: opts.maxResults,
      onUserExtracted: async (user) => {
        totalStored++;
        batchBuffer.push({
          fb_id: user.fb_id,
          name: user.name,
          profile_url: user.profile_url,
          type: "profile_visited",
          avatar_url: "",
          comment_text: [
            user.bio ? `bio: ${user.bio}` : null,
            user.location ? `location: ${user.location}` : null,
            user.workplace ? `work: ${user.workplace}` : null,
            user.education ? `edu: ${user.education}` : null,
            user.relationship ? `rel: ${user.relationship}` : null,
          ].filter(Boolean).join(" | ") || "",
          comment_id: "",
        });

        // Flush batch
        if (batchBuffer.length >= BATCH_FLUSH) {
          try {
            await supabaseService.storeResults(opts.jobId, opts.workspaceId, batchBuffer.splice(0));
            let enrichedBatch = Math.min(totalStored, batchBuffer.length);
            try {
              await enrichmentService.enrichJobResults(opts.jobId);
              totalEnriched += enrichedBatch;
            } catch {}
            await supabaseService.storeProgress(opts.jobId, {
              discovered: totalStored,
              processed: totalStored,
              phase: "visiting_profiles",
              enriched: totalEnriched,
              last_update: new Date().toISOString(),
            });
          } catch (err) {
            log.warn("Cascade", `batch flush failed: ${String(err).substring(0, 80)}`);
          }
          await sleep(1000);
        }

        if (totalStored >= opts.maxResults) {
          stopReason = "max_results";
        }
      },
      onDiscoverUser: (_user) => {
        // silently added to queue
      },
    });

    await visitor.visitBulk(seedUsers);

    // Final flush
    if (batchBuffer.length > 0) {
      try {
        await supabaseService.storeResults(opts.jobId, opts.workspaceId, batchBuffer);
      } catch {}
    }

    // Final enrichment
    if (opts.enableEnrichment && totalStored > 0) {
      try {
        await enrichmentService.enrichJobResults(opts.jobId);
        totalEnriched = totalStored;
      } catch {}
    }

    log.info("Cascade", `========================================`);
    log.info("Cascade", `total stored = ${totalStored}`);
    log.info("Cascade", `total enriched = ${totalEnriched}`);
    log.info("Cascade", `========================================`);

    return {
      totalExtracted: totalStored,
      totalEnriched,
      uniqueUsers: totalStored,
      postsProcessed: 0,
      stopReason: totalStored >= opts.maxResults ? "max_results" : "completed",
      pageInfo: { id: pageIdentifier, name: "", totalFollowers: null },
      checkpointPath,
    };
  } catch (err) {
    log.error("Cascade", `fatal: ${String(err).substring(0, 200)}`);
    return { totalExtracted: totalStored, totalEnriched: 0, uniqueUsers: totalStored, postsProcessed: 0, stopReason: "error", pageInfo: { id: pageIdentifier, name: "", totalFollowers: null }, checkpointPath };
  }
}

function loadCheckpoint(p: string): Checkpoint {
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8")); } catch {}
  return { collectedUserIds: [], totalStored: 0, lastSavedAt: "" };
}
