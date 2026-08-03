import Database from "better-sqlite3";
import { readdirSync } from "fs";
import { join } from "path";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { supabaseService } from "./supabase.js";

const log = logger;

interface EnrichmentRow {
  FBID: string;
  Phone: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  birthday: string | null;
  birthdayYear: string | null;
  gender: string | null;
  locale: string | null;
  hometown: string | null;
  location: string | null;
  country: string | null;
  work: string | null;
  education: string | null;
  relationship: string | null;
  religion: string | null;
  about_me: string | null;
}

interface EnrichmentResult {
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  birthday: string | null;
  birthdayYear: string | null;
  gender: string | null;
  hometown: string | null;
  location: string | null;
  country: string | null;
  work: string | null;
  education: string | null;
  relationship: string | null;
  religion: string | null;
  about_me: string | null;
  source_db: string;
}

interface EnrichmentStats {
  total: number;
  enriched: number;
  not_found: number;
  coverage_percent: number;
  sources: Record<string, number>;
}

function cleanFbId(fbId: string): string {
  let cleaned = fbId.trim();
  if (cleaned.startsWith("msg_")) cleaned = cleaned.slice(4);
  cleaned = cleaned.replace(/^\uFEFF/, "");
  return cleaned;
}

function scanDatabases(): { name: string; path: string }[] {
  try {
    const files = readdirSync(config.enrichmentDbPath);
    return files
      .filter((f) => f.endsWith(".db"))
      .map((f) => ({ name: f.replace(/\.db$/i, ""), path: join(config.enrichmentDbPath, f) }));
  } catch {
    log.warn("Enrichment", `cannot read db path: ${config.enrichmentDbPath}`);
    return [];
  }
}

function checkDbHealthy(db: Database.Database, name: string): boolean {
  try {
    const result = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    if (result.integrity_check !== "ok") {
      log.error("Enrichment", `${name}.db is CORRUPT — integrity_check failed. Will attempt per-ID lookups to salvage data. For full repair run: sqlite3 "${name}.db" ".recover" > recovered.sql`);
      return false;
    }
    return true;
  } catch (err) {
    log.error("Enrichment", `${name}.db integrity check error: ${String(err)}`);
    return false;
  }
}

function mapRow(row: Record<string, unknown>): EnrichmentRow {
  return {
    FBID: String(row.FBID || ""),
    Phone: row.Phone != null ? String(row.Phone) : null,
    first_name: row.first_name != null ? String(row.first_name) : null,
    last_name: row.last_name != null ? String(row.last_name) : null,
    email: row.email != null ? String(row.email) : null,
    birthday: row.birthday != null ? String(row.birthday) : null,
    birthdayYear: row.birthdayYear != null ? String(row.birthdayYear) : null,
    gender: row.gender != null ? String(row.gender) : null,
    locale: row.locale != null ? String(row.locale) : null,
    hometown: row.hometown != null ? String(row.hometown) : null,
    location: row.location != null ? String(row.location) : null,
    country: row.country != null ? String(row.country) : null,
    work: row.work != null ? String(row.work) : null,
    education: row.education != null ? String(row.education) : null,
    relationship: row.relationship != null ? String(row.relationship) : null,
    religion: row.religion != null ? String(row.religion) : null,
    about_me: row.about_me != null ? String(row.about_me) : null,
  };
}

function searchInDb(db: Database.Database, fbIds: string[], tableName: string = "data"): Map<string, EnrichmentRow> {
  const map = new Map<string, EnrichmentRow>();
  if (fbIds.length === 0) return map;

  let columns: string[] = [];
  try {
    const cols = db.prepare(`PRAGMA table_info('${tableName}')`).all() as { name: string }[];
    columns = cols.map(c => c.name);
  } catch {
    return map;
  }

  const availableCols = ["FBID", "Phone", "first_name", "last_name", "email", "birthday", "birthdayYear", "gender", "locale", "hometown", "location", "country", "work", "education", "relationship", "religion", "about_me"]
    .filter(c => columns.includes(c));
  if (!availableCols.includes("FBID")) return map;

  const selCols = availableCols.join(", ");
  const SQLITE_PARAM_LIMIT = 900;
  let found = 0;
  let failed = 0;
  let batchFailed = false;

  for (let start = 0; start < fbIds.length; start += SQLITE_PARAM_LIMIT) {
    const chunk = fbIds.slice(start, start + SQLITE_PARAM_LIMIT);
    const placeholders = chunk.map(() => "?").join(",");
    try {
      const rows = db.prepare(
        `SELECT ${selCols} FROM ${tableName} WHERE FBID IN (${placeholders})`
      ).all(...chunk) as Record<string, unknown>[];

      for (const row of rows) {
        const enrichmentRow = mapRow(row);
        const cleanId = cleanFbId(enrichmentRow.FBID);
        map.set(cleanId, enrichmentRow);
        found++;
      }
    } catch (err) {
      failed += chunk.length;
      batchFailed = true;
      const msg = String(err);
      if (msg.includes("malformed") || msg.includes("CORRUPT")) {
        log.warn("Enrichment", `batch query failed (chunk at ${start}), will retry per-ID: ${msg.substring(0, 100)}`);
      }
    }
  }

  if (batchFailed && found === 0) {
    log.info("Enrichment", `batch query failed entirely — falling back to per-ID lookups (${fbIds.length} IDs)`);
    const singleStmt = db.prepare(`SELECT ${selCols} FROM ${tableName} WHERE FBID = ?`);
    let perIdFound = 0;
    let perIdFailed = 0;
    for (const id of fbIds) {
      if (map.has(id)) continue;
      try {
        const row = singleStmt.get(id) as Record<string, unknown> | undefined;
        if (row) {
          const enrichmentRow = mapRow(row);
          const cleanId = cleanFbId(enrichmentRow.FBID);
          map.set(cleanId, enrichmentRow);
          perIdFound++;
          found++;
        }
      } catch {
        perIdFailed++;
      }
    }
    failed = perIdFailed;
    log.info("Enrichment", `per-ID fallback: ${perIdFound} found, ${perIdFailed} failed out of ${fbIds.length}`);
  }

  if (failed > 0 && found === 0) {
    log.warn("Enrichment", `${found} found, ${failed} failed out of ${fbIds.length} — DB may be corrupt`);
  } else if (failed > 0) {
    log.warn("Enrichment", `${found} found, ${failed} failed (partial) out of ${fbIds.length}`);
  }
  return map;
}

export const enrichmentService = {
  async enrichJobResults(jobId: string): Promise<void> {
    if (!config.enrichmentEnabled) {
      log.info("Enrichment", "disabled via ENRICHMENT_ENABLED=false");
      return;
    }

    const databases = scanDatabases();
    if (databases.length === 0) {
      log.info("Enrichment", `no .db files found in ${config.enrichmentDbPath}`);
      return;
    }

    const results = await supabaseService.getJobResultsForEnrichment(jobId);
    if (!results || results.length === 0) {
      log.info("Enrichment", `no results with fb_id for job ${jobId}`);
      return;
    }

    log.info("Enrichment", `=== ENRICHMENT STARTED === job=${jobId} resultCount=${results.length}`);

    try {
      const currentProgress = await supabaseService.getJob(jobId).then((j: any) => j.progress || {}).catch(() => ({}));
      await supabaseService.storeProgress(jobId, {
        ...currentProgress,
        phase: "enriching",
        last_update: new Date().toISOString(),
      });
    } catch (err) {
      log.debug("Enrichment", `storeProgress(enriching) failed: ${String(err)}`);
    }

    const allFbIds = results.map((r: { fb_id: string }) => cleanFbId(r.fb_id)).filter(Boolean);
    log.info("Enrichment", `sample FBIDs: ${allFbIds.slice(0, 5).join(', ')}`);
    const enrichedMap = new Map<string, EnrichmentResult>();
    const sources: Record<string, number> = {};

    for (const dbInfo of databases) {
      const remainingIds = allFbIds.filter((id) => !enrichedMap.has(id));
      if (remainingIds.length === 0) break;

      let db: Database.Database | null = null;
      try {
        db = new Database(dbInfo.path, { readonly: true });

        if (!checkDbHealthy(db, dbInfo.name)) {
          log.warn("Enrichment", `${dbInfo.name}.db is corrupt — attempting per-ID salvage (slower but recovers available data)`);
        }

        log.info("Enrichment", `loaded ${dbInfo.name}.db, searching ${remainingIds.length} FBIDs`);

        const batchSize = config.enrichmentBatchSize;
        for (let i = 0; i < remainingIds.length; i += batchSize) {
          const batch = remainingIds.slice(i, i + batchSize);
          const matches = searchInDb(db, batch);
          for (const [fbId, row] of matches) {
            enrichedMap.set(fbId, {
              phone: row.Phone || null,
              first_name: row.first_name || null,
              last_name: row.last_name || null,
              email: row.email || null,
              birthday: row.birthday || null,
              birthdayYear: row.birthdayYear || null,
              gender: row.gender || null,
              hometown: row.hometown || null,
              location: row.location || null,
              country: row.country || null,
              work: row.work || null,
              education: row.education || null,
              relationship: row.relationship || null,
              religion: row.religion || null,
              about_me: row.about_me || null,
              source_db: dbInfo.name,
            });
          }
          log.info("Enrichment", `batch ${Math.floor(i / batchSize) + 1}: ${matches.size} matches in ${dbInfo.name}.db`);
        }
      } catch (err) {
        log.error("Enrichment", `error searching ${dbInfo.name}.db: ${String(err)}`);
      } finally {
        if (db) db.close();
      }

      const countFromThisDb = Array.from(enrichedMap.values()).filter((v) => v.source_db === dbInfo.name).length;
      if (countFromThisDb > 0) sources[dbInfo.name] = countFromThisDb;
    }

    const enriched = enrichedMap.size;
    const notFound = allFbIds.length - enriched;
    const coveragePercent = allFbIds.length > 0 ? Math.round((enriched / allFbIds.length) * 100) : 0;

    const updates: { id: string; metadata: Record<string, unknown> }[] = [];
    for (const r of results) {
      const cleanId = cleanFbId(r.fb_id);
      const enrichment = enrichedMap.get(cleanId);
      if (enrichment) {
        updates.push({ id: r.id, metadata: { enrichment } });
      }
    }

    if (updates.length > 0) {
      await supabaseService.updateResultMetadataBatch(jobId, updates);
      log.info("Enrichment", `updated ${updates.length} results with enrichment data`);
    }

    const stats: EnrichmentStats = {
      total: allFbIds.length,
      enriched,
      not_found: notFound,
      coverage_percent: coveragePercent,
      sources,
    };

    await supabaseService.updateJob(jobId, {
      progress: await supabaseService.getJob(jobId).then((j: any) => ({
        ...(j.progress || {}),
        phase: "completed",
        enrichment: stats,
        last_update: new Date().toISOString(),
      })).catch(() => ({ phase: "completed", enrichment: stats })),
    });

    log.info("Enrichment", `done: ${enriched}/${allFbIds.length} enriched (${coveragePercent}%)`, { sources });
  },
};