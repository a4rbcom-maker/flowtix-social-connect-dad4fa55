/** Enrichment DB scans run on a dedicated worker thread: better-sqlite3 is
 * synchronous and a full-table name scan over a 2.1GB file stalls the main
 * event loop — every HTTP request (including new job starts) froze during
 * enrichment. The worker returns plain serializable data. */
import { parentPort, workerData } from "worker_threads";
import Database from "better-sqlite3";

interface ScanRequest {
  dbPath: string;
  dbName: string;
  fbIds?: string[];
  targetNames?: string[];
  /** IG: last-9-digit phone suffixes to match against Phone LIKE '%…' */
  igPhoneSuffixes?: string[];
  /** IG: lowercase emails to match against the email column */
  igEmails?: string[];
}

interface OutRow {
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

function cleanFbId(fbId: string): string {
  let cleaned = fbId.trim();
  if (cleaned.startsWith("msg_")) cleaned = cleaned.slice(4);
  cleaned = cleaned.replace(/^\uFEFF/, "");
  return cleaned;
}

function normalizeFullName(a: unknown, b?: unknown): string {
  return `${a ?? ""} ${b ?? ""}`.trim().toLowerCase().replace(/\s+/g, " ");
}

function mapRow(row: Record<string, unknown>): OutRow {
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

const ENRICHMENT_COLS = ["FBID", "Phone", "first_name", "last_name", "email", "birthday", "birthdayYear", "gender", "locale", "hometown", "location", "country", "work", "education", "relationship", "religion", "about_me"];

function availableColumns(db: Database.Database, tableName: string): string[] {
  try {
    const cols = db.prepare(`PRAGMA table_info('${tableName}')`).all() as { name: string }[];
    return cols.map((c) => c.name);
  } catch {
    return [];
  }
}

/** Batch FBID lookup — mirrors enrichment-service searchInDb (chunumber chunks of 900). */
function searchFbIds(db: Database.Database, fbIds: string[], tableName = "data"): Map<string, OutRow> {
  const map = new Map<string, OutRow>();
  if (fbIds.length === 0) return map;

  const columns = availableColumns(db, tableName);
  const availableCols = ENRICHMENT_COLS.filter((c) => columns.includes(c));
  if (!availableCols.includes("FBID")) return map;
  const selCols = availableCols.join(", ");

  const SQLITE_PARAM_LIMIT = 900;
  for (let start = 0; start < fbIds.length; start += SQLITE_PARAM_LIMIT) {
    const chunk = fbIds.slice(start, start + SQLITE_PARAM_LIMIT);
    const placeholders = chunk.map(() => "?").join(",");
    try {
      const rows = db.prepare(
        `SELECT ${selCols} FROM ${tableName} WHERE FBID IN (${placeholders})`
      ).all(...chunk) as Record<string, unknown>[];
      for (const row of rows) {
        const r = mapRow(row);
        map.set(cleanFbId(r.FBID), r);
      }
    } catch {
      /* chunk tolerated; remaining IDs may match in per-ID salvage below */
    }
  }
  return map;
}

/** Unique full-name scan — mirrors enrichment-service searchByUniqueFullName. */
function searchUniqueNames(db: Database.Database, targetNames: Set<string>): Map<string, OutRow> {
  const unique = new Map<string, OutRow>();
  const ambiguous = new Set<string>();
  const stmt = db.prepare(
    "SELECT FBID, Phone, first_name, last_name, email, birthday, birthdayYear, gender, locale, hometown, location, country, work, education, relationship, religion, about_me FROM data"
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

/** IG phone-suffix scan: Phone LIKE '%<suffix>' over the enrichment DB,
 *  executed here (worker thread) so the 2.1GB file never stalls the main
 *  event loop. Mirrors enrichment-service searchIgInDb semantics. */
function searchIgPhones(db: Database.Database, suffixes: string[], tableName = "data"): Map<string, OutRow> {
  const map = new Map<string, OutRow>();
  if (suffixes.length === 0) return map;
  const columns = availableColumns(db, tableName);
  if (!columns.includes("Phone")) return map;
  const stmt = db.prepare(`SELECT * FROM ${tableName} WHERE Phone LIKE ?`);
  for (const suffix of suffixes) {
    try {
      const rows = stmt.all(`%${suffix}`) as Record<string, unknown>[];
      for (const row of rows) {
        const r = mapRow(row);
        const raw = r.Phone || "";
        // Key by normalized last-9 so the caller maps candidate → hit directly
        const digits = raw.replace(/\D/g, "");
        const key = digits.length >= 9 ? digits.slice(-9) : digits;
        if (key && !map.has(key)) map.set(key, r);
      }
    } catch {
      /* per-suffix tolerated */
    }
  }
  return map;
}

/** IG email scan — same rationale as searchIgPhones. */
function searchIgEmails(db: Database.Database, emails: string[], tableName = "data"): Map<string, OutRow> {
  const map = new Map<string, OutRow>();
  if (emails.length === 0) return map;
  const columns = availableColumns(db, tableName);
  if (!columns.includes("email")) return map;
  const SQLITE_PARAM_LIMIT = 400;
  for (let start = 0; start < emails.length; start += SQLITE_PARAM_LIMIT) {
    const chunk = emails.slice(start, start + SQLITE_PARAM_LIMIT);
    const placeholders = chunk.map(() => "?").join(",");
    try {
      const rows = db.prepare(
        `SELECT * FROM ${tableName} WHERE LOWER(email) IN (${placeholders})`
      ).all(...chunk) as Record<string, unknown>[];
      for (const row of rows) {
        const r = mapRow(row);
        const key = (r.email || "").toLowerCase();
        if (key && !map.has(key)) map.set(key, r);
      }
    } catch {
      /* chunk tolerated */
    }
  }
  return map;
}

const req = workerData as ScanRequest;
try {
  const db = new Database(req.dbPath, { readonly: true });
  const t0 = Date.now();
  let fbIdMatches: [string, OutRow][] = [];
  let nameMatches: [string, OutRow][] = [];
  let igPhoneMatches: [string, OutRow][] = [];
  let igEmailMatches: [string, OutRow][] = [];

  if (req.fbIds && req.fbIds.length > 0) {
    fbIdMatches = Array.from(searchFbIds(db, req.fbIds));
  }
  if (req.targetNames && req.targetNames.length > 0) {
    nameMatches = Array.from(searchUniqueNames(db, new Set(req.targetNames)));
  }
  if (req.igPhoneSuffixes && req.igPhoneSuffixes.length > 0) {
    igPhoneMatches = Array.from(searchIgPhones(db, req.igPhoneSuffixes));
  }
  if (req.igEmails && req.igEmails.length > 0) {
    igEmailMatches = Array.from(searchIgEmails(db, req.igEmails));
  }
  db.close();
  parentPort!.postMessage({ ok: true, elapsedMs: Date.now() - t0, fbIdMatches, nameMatches, igPhoneMatches, igEmailMatches });
} catch (err) {
  parentPort!.postMessage({ ok: false, error: String(err) });
}
