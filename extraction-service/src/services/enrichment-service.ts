import Database from "better-sqlite3";
import { readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { Worker } from "worker_threads";
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
  match_confidence?: "probable";
  match_method?: "full_name";
}

interface EnrichmentStats {
  total: number;
  enriched: number;
  not_found: number;
  coverage_percent: number;
  sources: Record<string, number>;
  name_matched?: number;
  new_format_ids?: number;
}

function cleanFbId(fbId: string): string {
  let cleaned = fbId.trim();
  if (cleaned.startsWith("msg_")) cleaned = cleaned.slice(4);
  cleaned = cleaned.replace(/^\uFEFF/, "");
  return cleaned;
}

function normalizeFullName(a: unknown, b?: unknown): string {
  return `${a ?? ""} ${b ?? ""}`.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Name fallback for FB jobs: the leaked DB predates Facebook's 615... ID
 *  format, so members holding new-format accounts can never match by FBID.
 *  One streaming pass over the DB finds target names that appear EXACTLY
 *  once (unique full name) — ambiguous/common names are skipped because a
 *  wrong-person phone number is worse than no match. */
function searchByUniqueFullName(
  db: Database.Database,
  targetNames: Set<string>,
): Map<string, EnrichmentRow> {
  const unique = new Map<string, EnrichmentRow>();
  const ambiguous = new Set<string>();
  const stmt = db.prepare(
    "SELECT FBID, Phone, first_name, last_name, email, birthday, birthdayYear, gender, locale, hometown, location, country, work, education, relationship, religion, about_me FROM data",
  );
  for (const row of (stmt as unknown as { iterate(): Iterable<Record<string, unknown>> }).iterate()) {
    const full = normalizeFullName(row.first_name, row.last_name);
    if (!full || (!targetNames.has(full) && !unique.has(full) && !ambiguous.has(full))) continue;
    if (!unique.has(full)) {
      if (ambiguous.has(full) || !targetNames.has(full)) continue;
      unique.set(full, mapRow(row));
    } else {
      unique.delete(full);
      ambiguous.add(full);
    }
  }
  return unique;
}

/** Accepts either a directory containing .db files or a direct path to one .db file. */
export function scanDatabases(): { name: string; path: string; sizeBytes: number }[] {
  const root = config.enrichmentDbPath;
  try {
    if (!root || !existsSync(root)) {
      log.error("Enrichment", `enrichment db path does not exist: [${root}] — enrichment will be SKIPPED. Upload .db files there (see GET /enrichment/status).`);
      return [];
    }
    const stat = statSync(root);
    if (stat.isFile()) {
      if (!root.toLowerCase().endsWith(".db")) {
        log.error("Enrichment", `enrichment db path is a file but not a .db: [${root}]`);
        return [];
      }
      return [{ name: root.replace(/\.db$/i, "").split(/[\\/]/).pop() || "db", path: root, sizeBytes: stat.size }];
    }
    const files = readdirSync(root);
    const dbs = files
      .filter((f) => f.toLowerCase().endsWith(".db"))
      .map((f) => {
        const full = join(root, f);
        return { name: f.replace(/\.db$/i, ""), path: full, sizeBytes: statSync(full).isFile() ? statSync(full).size : 0 };
      })
      .filter((d) => d.sizeBytes > 0);
    if (dbs.length === 0) {
      log.error("Enrichment", `no .db files found in [${root}] — enrichment will be SKIPPED. Upload .db files there (see GET /enrichment/status).`);
    } else {
      log.info("Enrichment", `found ${dbs.length} enrichment db(s): ${dbs.map((d) => `${d.name}.db (${(d.sizeBytes / 1024 / 1024).toFixed(1)}MB)`).join(", ")}`);
    }
    return dbs;
  } catch (err) {
    log.error("Enrichment", `cannot read db path [${root}]: ${String(err)}`);
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

interface WorkerScanResult {
  ok: boolean;
  elapsedMs?: number;
  fbIdMatches?: [string, Record<string, string | null>][];
  nameMatches?: [string, Record<string, string | null>][];
  igPhoneMatches?: [string, Record<string, string | null>][];
  igEmailMatches?: [string, Record<string, string | null>][];
  error?: string;
}

/** Runs FBID + unique-name scans inside a worker thread so the 2.1GB SQLite
 *  full scans never block the main event loop (HTTP stays responsive). */
function runEnrichmentScan(
  dbInfo: { name: string; path: string },
  fbIds: string[],
  targetNames: string[] = [],
): Promise<{ fbIdMatches: [string, any][]; nameMatches: [string, any][]; elapsedMs: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./enrichment-worker.js", import.meta.url), {
      workerData: { dbPath: dbInfo.path, dbName: dbInfo.name, fbIds, targetNames },
    });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error(`enrichment scan timeout in ${dbInfo.name}.db`));
    }, config.enrichmentTimeoutMs);
    worker.on("message", (msg: WorkerScanResult) => {
      clearTimeout(timeout);
      worker.terminate();
      if (!msg.ok) return reject(new Error(msg.error || `scan failed in ${dbInfo.name}.db`));
      resolve({ fbIdMatches: msg.fbIdMatches ?? [], nameMatches: msg.nameMatches ?? [], elapsedMs: msg.elapsedMs ?? 0 });
    });
    worker.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/** IG variant of the worker scan: phone suffixes + emails + unique names.
 *  IG enrichment previously ran better-sqlite3 scans on the MAIN thread —
 *  a Phone LIKE over the 2.1GB DB froze the whole service (health checks,
 *  new jobs, everything) until the scan finished. */
function runIgEnrichmentScan(
  dbInfo: { name: string; path: string },
  phoneSuffixes: string[],
  emails: string[],
  targetNames: string[],
): Promise<{ phoneHits: Map<string, any>; emailHits: Map<string, any>; nameHits: Map<string, any>; elapsedMs: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./enrichment-worker.js", import.meta.url), {
      workerData: {
        dbPath: dbInfo.path,
        dbName: dbInfo.name,
        fbIds: [],
        targetNames,
        igPhoneSuffixes: phoneSuffixes,
        igEmails: emails,
      },
    });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error(`IG enrichment scan timeout in ${dbInfo.name}.db`));
    }, config.enrichmentTimeoutMs);
    worker.on("message", (msg: WorkerScanResult) => {
      clearTimeout(timeout);
      worker.terminate();
      if (!msg.ok) return reject(new Error(msg.error || `IG scan failed in ${dbInfo.name}.db`));
      resolve({
        phoneHits: new Map(msg.igPhoneMatches ?? []),
        emailHits: new Map(msg.igEmailMatches ?? []),
        nameHits: new Map(msg.nameMatches ?? []),
        elapsedMs: msg.elapsedMs ?? 0,
      });
    });
    worker.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
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

/** Batch FBID lookup against a SQLite enrichment table (exported for testing). */
export function searchInDb(db: Database.Database, fbIds: string[], tableName: string = "data"): Map<string, EnrichmentRow> {
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

interface IgCandidate {
  phone9: string | null;
  email: string | null;
  fullName: string | null;
}

interface IgSearchHit {
  phone: Map<string, EnrichmentRow>;
  email: Map<string, EnrichmentRow>;
  fullName: Map<string, EnrichmentRow>;
}

/** تطبيع رقم مصري إلى آخر 9 أرقام (إزالة +20/0020/0/مسافات/شرطات) */
function normalizeEgyptPhone(phone: string): string {
  let p = phone.replace(/\D/g, "");
  if (p.startsWith("0020")) p = p.slice(4);
  else if (p.startsWith("20")) p = p.slice(2);
  else if (p.startsWith("0")) p = p.slice(1);
  return p;
}

/** بحث نتائج IG في قاعدة SQLite: هاتف/بريد (confirmed) ثم اسم كامل (probable) */
function searchIgInDb(db: Database.Database, tableName: string, candidates: IgCandidate[]): IgSearchHit {
  const hits: IgSearchHit = {
    phone: new Map(),
    email: new Map(),
    fullName: new Map(),
  };
  let columns: string[] = [];
  try {
    const cols = db.prepare(`PRAGMA table_info('${tableName}')`).all() as { name: string }[];
    columns = cols.map((c) => c.name);
  } catch {
    return hits;
  }

  const phones = Array.from(new Set(candidates.map((c) => c.phone9).filter((v): v is string => !!v)));
  if (phones.length > 0 && columns.includes("Phone")) {
    const SQLITE_PARAM_LIMIT = 400;
    for (let i = 0; i < phones.length; i += SQLITE_PARAM_LIMIT) {
      const chunk = phones.slice(i, i + SQLITE_PARAM_LIMIT);
      const stmt = db.prepare(`SELECT * FROM ${tableName} WHERE Phone LIKE ?`);
      for (const p of chunk) {
        try {
          const rows = stmt.all(`%${p}`) as Record<string, unknown>[];
          for (const row of rows) {
            const r = mapRow(row);
            const norm = normalizeEgyptPhone(r.Phone || "");
            const key = norm.length >= 9 ? norm.slice(-9) : norm;
            if (!hits.phone.has(key)) hits.phone.set(key, r);
          }
        } catch {
          /* per-id errors are tolerated */
        }
      }
    }
  }

  const emails = Array.from(new Set(candidates.map((c) => c.email).filter((v): v is string => !!v)));
  if (emails.length > 0 && columns.includes("email")) {
    const SQLITE_PARAM_LIMIT = 400;
    for (let i = 0; i < emails.length; i += SQLITE_PARAM_LIMIT) {
      const chunk = emails.slice(i, i + SQLITE_PARAM_LIMIT);
      const placeholders = chunk.map(() => "?").join(",");
      try {
        const rows = db.prepare(`SELECT * FROM ${tableName} WHERE LOWER(email) IN (${placeholders})`).all(...chunk.map((e) => e.toLowerCase())) as Record<string, unknown>[];
        for (const row of rows) {
          const r = mapRow(row);
          const key = (r.email || "").toLowerCase();
          if (!hits.email.has(key)) hits.email.set(key, r);
        }
      } catch {
        /* tolerate */
      }
    }
  }

  const names = Array.from(new Set(candidates.map((c) => c.fullName).filter((v): v is string => !!v)));
  if (names.length > 0 && columns.includes("first_name") && columns.includes("last_name")) {
    const SQLITE_PARAM_LIMIT = 400;
    for (let i = 0; i < names.length; i += SQLITE_PARAM_LIMIT) {
      const chunk = names.slice(i, i + SQLITE_PARAM_LIMIT);
      const clauses = chunk.map(() => `LOWER(first_name || ' ' || last_name) = LOWER(?)`).join(" OR ");
      try {
        const rows = db.prepare(`SELECT * FROM ${tableName} WHERE ${clauses}`).all(...chunk) as Record<string, unknown>[];
        for (const row of rows) {
          const r = mapRow(row);
          const key = `${r.first_name || ""} ${r.last_name || ""}`.trim().toLowerCase();
          if (!hits.fullName.has(key)) hits.fullName.set(key, r);
        }
      } catch {
        /* tolerate */
      }
    }
  }

  return hits;
}

function enrichmentRowToPayload(row: EnrichmentRow & { source_db?: string }): Record<string, unknown> {
  return {
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
    source_db: row.source_db,
  };
}

export const enrichmentService = {
  /** Record an enrichment skip/failure into job progress so it is visible in the dashboard. */
  async recordEnrichmentSkip(jobId: string, reason: string, detail: Record<string, unknown> = {}): Promise<void> {
    try {
      const job = await supabaseService.getJob(jobId);
      const current = (job?.progress || {}) as Record<string, unknown>;
      await supabaseService.storeProgress(jobId, {
        ...current,
        enrichment: { error: reason, enriched: 0, ...detail },
        last_update: new Date().toISOString(),
      });
    } catch {
      /* best effort */
    }
  },

  async enrichJobResults(jobId: string): Promise<void> {
    if (!config.enrichmentEnabled) {
      log.warn("Enrichment", "disabled via ENRICHMENT_ENABLED=false");
      await this.recordEnrichmentSkip(jobId, "ENRICHMENT_DISABLED");
      return;
    }

    const databases = scanDatabases();
    if (databases.length === 0) {
      log.error("Enrichment", `job ${jobId.slice(0, 8)}: enrichment SKIPPED — no database at [${config.enrichmentDbPath}]`);
      await this.recordEnrichmentSkip(jobId, "ENRICHMENT_DB_MISSING", { db_path: config.enrichmentDbPath });
      return;
    }

    const results = await supabaseService.getJobResultsForEnrichment(jobId);
    if (!results || results.length === 0) {
      log.info("Enrichment", `no results with fb_id for job ${jobId}`);
      return;
    }

    const job = await supabaseService.getJob(jobId).catch(() => null);
    const jobType = (job as any)?.type || "";
    if (typeof jobType === "string" && jobType.startsWith("ig_")) {
      await this.enrichIgJobResults(jobId, results, databases);
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
    const newFormatIds = allFbIds.filter((id) => /^615\d+/.test(id)).length;
    if (newFormatIds > 0) {
      log.info("Enrichment", `${newFormatIds}/${allFbIds.length} results hold new-format 615* FBIDs — these postdate the leaked DB and can only match by unique full name`);
    }
    log.info("Enrichment", `sample FBIDs: ${allFbIds.slice(0, 5).join(', ')}`);
    const enrichedMap = new Map<string, EnrichmentResult>();
    const sources: Record<string, number> = {};

    for (const dbInfo of databases) {
      const remainingIds = allFbIds.filter((id) => !enrichedMap.has(id));
      if (remainingIds.length === 0) break;

      const scan = await runEnrichmentScan(dbInfo, remainingIds);
      for (const [fbId, row] of scan.fbIdMatches) {
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
      log.info("Enrichment", `${dbInfo.name}.db scan: ${scan.fbIdMatches.length} FBID matches (${(scan.elapsedMs / 1000).toFixed(1)}s worker)`);

      const countFromThisDb = Array.from(enrichedMap.values()).filter((v) => v.source_db === dbInfo.name).length;
      if (countFromThisDb > 0) sources[dbInfo.name] = countFromThisDb;
    }

    // ---- Name fallback (probable matches) --------------------------------
    // Runs only for results the FBID pass could not enrich. Unique full-name
    // rows in the DB are matched and explicitly flagged probable so the UI
    // can separate confirmed identity from name-based inference.
    let nameMatched = 0;
    const unmatchedByName = new Map<string, string>();
    for (const r of results) {
      const cleanId = cleanFbId(r.fb_id);
      if (enrichedMap.has(cleanId)) continue;
      const name = typeof r.data?.name === "string" ? r.data.name.trim().toLowerCase().replace(/\s+/g, " ") : "";
      if (name && !unmatchedByName.has(name)) unmatchedByName.set(name, cleanId);
    }

    if (unmatchedByName.size > 0) {
      for (const dbInfo of databases) {
        if (unmatchedByName.size === 0) break;
        const scan = await runEnrichmentScan(dbInfo, [], Array.from(unmatchedByName.keys()));
        for (const [name, row] of scan.nameMatches) {
          const fbId = unmatchedByName.get(name);
          if (!fbId || enrichedMap.has(fbId)) continue;
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
            match_confidence: "probable",
            match_method: "full_name",
          });
          unmatchedByName.delete(name);
          nameMatched++;
        }
        log.info("Enrichment", `name fallback in ${dbInfo.name}.db: +${scan.nameMatches.length} unique-name matches (${(scan.elapsedMs / 1000).toFixed(0)}s worker scan)`);
      }
    }

    const enriched = enrichedMap.size;
    const notFound = allFbIds.length - enriched;
    const coveragePercent = allFbIds.length > 0 ? Math.round((enriched / allFbIds.length) * 100) : 0;

    const updates: { id: string; metadata: Record<string, unknown> }[] = [];
    for (const r of results) {
      const cleanId = cleanFbId(r.fb_id);
      const enrichment = enrichedMap.get(cleanId);
      if (enrichment) {
        const metadata: Record<string, unknown> = { enrichment };
        if (enrichment.match_confidence) {
          metadata.match_confidence = enrichment.match_confidence;
          metadata.match_method = enrichment.match_method;
        }
        updates.push({ id: r.id, metadata });
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
      name_matched: nameMatched,
      new_format_ids: newFormatIds,
    };

    await supabaseService.updateJob(jobId, {
      progress: await supabaseService.getJob(jobId).then((j: any) => ({
        ...(j.progress || {}),
        phase: "completed",
        enrichment: stats,
        last_update: new Date().toISOString(),
      })).catch(() => ({ phase: "completed", enrichment: stats })),
    });

    log.info("Enrichment", `done: ${enriched}/${allFbIds.length} enriched (${coveragePercent}%, name-matched ${nameMatched}, new-format ${newFormatIds})`, { sources });
  },

  /** إثراء نتائج إنستجرام: bio (هاتف/بريد) → confirmed، وإلا الاسم الكامل → probable */
  async enrichIgJobResults(
    jobId: string,
    results: { id: string; fb_id: string; data: Record<string, unknown> }[],
    databases: { name: string; path: string }[]
  ): Promise<void> {
    log.info("Enrichment", `=== IG ENRICHMENT STARTED === job=${jobId} resultCount=${results.length}`);

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

    const candidates: IgCandidate[] = results.map((r) => {
      const d = r.data || {};
      const bioPhone = typeof d.bio_phone === "string" ? d.bio_phone : null;
      const bioEmail = typeof d.bio_email === "string" ? d.bio_email.trim() : null;
      const fullName = typeof d.full_name === "string" ? d.full_name.trim() : null;
      const phone9 = bioPhone ? normalizeEgyptPhone(bioPhone).slice(-9) : null;
      return { phone9: phone9 && phone9.length >= 9 ? phone9 : null, email: bioEmail || null, fullName: fullName || null };
    });

    const hasAnyBio = candidates.some((c) => c.phone9 || c.email);
    const hasAnyName = candidates.some((c) => c.fullName);
    if (!hasAnyBio && !hasAnyName) {
      log.info("Enrichment", `IG job ${jobId}: no bio contact or full_name present to match — skipping`);
      return;
    }

    const matches = new Map<number, { row: EnrichmentRow; method: "bio_phone" | "bio_email" | "full_name"; sourceDb: string }>();
    const sources: Record<string, number> = {};

    const phoneSuffixes = Array.from(new Set(candidates.map((c) => c.phone9).filter((v): v is string => !!v)));
    const emails = Array.from(new Set(candidates.map((c) => c.email).filter((v): v is string => !!v).map((e) => e.toLowerCase())));
    const names = Array.from(new Set(candidates.map((c) => c.fullName).filter((v): v is string => !!v).map((n) => n.toLowerCase())));

    for (const dbInfo of databases) {
      try {
        // Worker thread: the 2.1GB scans must never run on the main loop.
        const scan = await runIgEnrichmentScan(dbInfo, phoneSuffixes, emails, names);
        for (let i = 0; i < candidates.length; i++) {
          if (matches.has(i)) continue;
          const c = candidates[i];
          let hit: Record<string, string | null> | undefined;
          let method: "bio_phone" | "bio_email" | "full_name" | undefined;
          if (c.phone9) {
            hit = scan.phoneHits.get(c.phone9);
            if (hit) method = "bio_phone";
          }
          if (!hit && c.email) {
            hit = scan.emailHits.get(c.email.toLowerCase());
            if (hit) method = "bio_email";
          }
          if (!hit && c.fullName) {
            hit = scan.nameHits.get(c.fullName.toLowerCase());
            if (hit) method = "full_name";
          }
          if (hit && method) {
            const row = { ...mapRow(hit as Record<string, unknown>), source_db: dbInfo.name };
            matches.set(i, { row, method, sourceDb: dbInfo.name });
          }
        }
        log.info("Enrichment", `${dbInfo.name}.db IG scan: ${(scan.elapsedMs / 1000).toFixed(1)}s worker (phones=${phoneSuffixes.length}, emails=${emails.length}, names=${names.length})`);
      } catch (err) {
        log.error("Enrichment", `IG error searching ${dbInfo.name}.db: ${String(err)}`);
      }
      const countFromThisDb = Array.from(matches.values()).filter((m) => m.sourceDb === dbInfo.name).length;
      if (countFromThisDb > 0) sources[dbInfo.name] = countFromThisDb;
    }

    const updates: { id: string; metadata: Record<string, unknown> }[] = [];
    for (let i = 0; i < results.length; i++) {
      const m = matches.get(i);
      if (!m) continue;
      updates.push({
        id: results[i].id,
        metadata: {
          platform: "instagram",
          enrichment: enrichmentRowToPayload(m.row),
          match_confidence: m.method === "full_name" ? "probable" : "confirmed",
          match_method: m.method,
        },
      });
    }

    if (updates.length > 0) {
      await supabaseService.updateResultMetadataBatch(jobId, updates);
      log.info("Enrichment", `IG updated ${updates.length} results with enrichment metadata`);
    }

    const stats: EnrichmentStats = {
      total: results.length,
      enriched: updates.length,
      not_found: results.length - updates.length,
      coverage_percent: results.length > 0 ? Math.round((updates.length / results.length) * 100) : 0,
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

    log.info("Enrichment", `IG done: ${updates.length}/${results.length} enriched (${stats.coverage_percent}%)`, { sources });
  },
};