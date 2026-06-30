#!/usr/bin/env node
// ETL: import Egypt / Iraq Facebook people SQLite databases into Postgres
// (Lovable Cloud) table public.fb_people_db.
//
// Usage (on the VPS where the .db files live):
//   export DATABASE_URL="postgres://...?sslmode=require"   # full Postgres URL
//   node scripts/etl-fb-people-db.mjs \
//     --country=EG --sqlite=/path/to/egypt.db \
//     [--batch=5000] [--start=1] [--end=999999999] [--truncate]
//
// Then for Iraq:
//   node scripts/etl-fb-people-db.mjs --country=IQ --sqlite=/path/to/Iraq.db
//
// After BOTH countries are imported, run once with --post-index to build the
// heavy GIN trigram index for fuzzy name search:
//   node scripts/etl-fb-people-db.mjs --post-index
//
// Requirements (install once on the VPS in the project root):
//   npm i -D better-sqlite3 pg pg-copy-streams
//
// Behaviour:
// * Pages by primary key (id BETWEEN ? AND ?) so a single corrupt SQLite page
//   only loses one batch (we halve and retry, then skip).
// * Normalizes phone, name, "None"/"" -> NULL.
// * Uses Postgres COPY for bulk insert (10-100x faster than INSERT).
// * Idempotent on phone: ON CONFLICT (country, phone_norm) DO NOTHING via the
//   partial unique index — we route through a staging table to dedupe safely.

import { argv, exit, env, stdout } from "node:process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { performance } from "node:perf_hooks";

// ---- argv ----
const args = Object.fromEntries(
  argv.slice(2).map((a) => {
    if (!a.startsWith("--")) return [a, true];
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);

const POST_INDEX = !!args["post-index"];
const COUNTRY = String(args.country || "").toUpperCase();
const SQLITE_PATH = args.sqlite ? String(args.sqlite) : null;
const BATCH = Number(args.batch || 5000);
const START_ID = Number(args.start || 1);
const END_ID = args.end ? Number(args.end) : Infinity;
const TRUNCATE = !!args.truncate;

const DATABASE_URL = env.DATABASE_URL || env.SUPABASE_DB_URL;
if (!DATABASE_URL) {
  console.error("ERROR: set DATABASE_URL (or SUPABASE_DB_URL) env var.");
  exit(2);
}

// ---- dynamic imports so users without deps see a clear message ----
let Database, Pool, copyFrom;
try {
  Database = (await import("better-sqlite3")).default;
  ({ Pool } = await import("pg"));
  copyFrom = (await import("pg-copy-streams")).from;
} catch (e) {
  console.error(
    "Missing deps. Run:  npm i -D better-sqlite3 pg pg-copy-streams\n",
    e?.message || e,
  );
  exit(2);
}

const pg = new Pool({ connectionString: DATABASE_URL, max: 3 });

// ---- normalization helpers ----
function nz(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s === "None" || s === "None." || s === "0" || s === "null") return null;
  return s;
}
function normPhone(p, country) {
  if (!p) return null;
  let s = String(p).replace(/[^\d]/g, "");
  if (!s) return null;
  // Egypt: 2010..., strip leading 20. Iraq: 9647..., strip leading 964.
  if (country === "EG" && s.startsWith("20")) s = s.slice(2);
  if (country === "IQ" && s.startsWith("964")) s = s.slice(3);
  if (s.length < 7) return null;
  return s.slice(-10);
}
const AR_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
function normName(first, last) {
  const joined = `${first || ""} ${last || ""}`.trim();
  if (!joined) return null;
  return joined
    .toLowerCase()
    .replace(AR_DIACRITICS, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim() || null;
}

// COPY escape: text format, columns separated by \t, NULL = \N, escape \t,\n,\\
function copyEscape(v) {
  if (v === null || v === undefined) return "\\N";
  const s = String(v);
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

// COLUMN ORDER for COPY -- must match below.
const COLS = [
  "country","fbid","phone_norm","phone_raw","first_name","last_name",
  "name_norm","email","gender","hometown","location","work","education",
  "relationship","religion","birthday","birthday_year","locale","about_me",
];

function rowToTsv(country, r) {
  const first = nz(r.first_name);
  const last  = nz(r.last_name);
  const fields = [
    country,
    nz(r.FBID),
    normPhone(r.Phone, country),
    nz(r.Phone),
    first,
    last,
    normName(first, last),
    nz(r.email),
    nz(r.gender),
    nz(r.hometown),
    nz(r.location),
    nz(r.work),
    nz(r.education),
    nz(r.relationship),
    nz(r.religion),
    nz(r.birthday),
    nz(r.birthdayYear),
    nz(r.locale),
    nz(r.about_me),
  ];
  return fields.map(copyEscape).join("\t") + "\n";
}

// ---- post-index step ----
async function postIndex() {
  console.log("[post-index] creating GIN trigram index on name_norm (this can take 5-30 min on 45M rows)...");
  const t0 = performance.now();
  const client = await pg.connect();
  try {
    await client.query("SET maintenance_work_mem = '1GB'");
    await client.query(`
      CREATE INDEX IF NOT EXISTS fb_people_db_name_trgm_idx
        ON public.fb_people_db
        USING GIN (name_norm extensions.gin_trgm_ops)
        WHERE name_norm IS NOT NULL;
    `);
    await client.query("ANALYZE public.fb_people_db");
    const { rows } = await client.query("SELECT COUNT(*)::bigint AS n, country FROM public.fb_people_db GROUP BY country ORDER BY country");
    console.log("[post-index] done in", ((performance.now() - t0) / 1000).toFixed(1), "s");
    console.log("[post-index] counts:", rows);
  } finally {
    client.release();
  }
  await pg.end();
}

if (POST_INDEX) {
  await postIndex();
  exit(0);
}

// ---- import step ----
if (!COUNTRY || !["EG", "IQ"].includes(COUNTRY)) {
  console.error("ERROR: --country must be EG or IQ");
  exit(2);
}
if (!SQLITE_PATH) {
  console.error("ERROR: --sqlite=/path/to/file.db is required");
  exit(2);
}

if (TRUNCATE) {
  console.log(`[truncate] removing existing rows for country=${COUNTRY}`);
  await pg.query("DELETE FROM public.fb_people_db WHERE country=$1", [COUNTRY]);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
sqlite.pragma("journal_mode = OFF");
sqlite.pragma("synchronous = OFF");

// figure out max id
let maxId = END_ID;
try {
  const r = sqlite.prepare("SELECT MAX(id) AS m FROM data").get();
  if (r && r.m) maxId = Math.min(END_ID, r.m);
} catch {
  // index corrupt -> fall back to sqlite_sequence
  try {
    const r = sqlite.prepare("SELECT seq AS m FROM sqlite_sequence WHERE name='data'").get();
    if (r && r.m) maxId = Math.min(END_ID, r.m);
  } catch {}
}
console.log(`[import] country=${COUNTRY} sqlite=${SQLITE_PATH} ids=${START_ID}..${maxId} batch=${BATCH}`);

// Use a staging table to safely COPY then upsert into target by (country, phone_norm).
const STAGING = `fb_people_db_stage_${COUNTRY.toLowerCase()}_${Date.now()}`;

const setupClient = await pg.connect();
try {
  await setupClient.query(`
    CREATE TEMP TABLE "${STAGING}" (
      country text, fbid text, phone_norm text, phone_raw text,
      first_name text, last_name text, name_norm text, email text,
      gender text, hometown text, location text, work text, education text,
      relationship text, religion text, birthday text, birthday_year text,
      locale text, about_me text
    ) ON COMMIT DROP;
  `);
} catch (e) {
  console.error("Failed to create staging table:", e.message);
  exit(1);
}

// Note: TEMP tables die with the session; we must keep this client alive for the run.

async function copyBatch(rows) {
  if (!rows.length) return 0;
  const tsv = rows.map((r) => rowToTsv(COUNTRY, r)).join("");
  const stream = setupClient.query(copyFrom(
    `COPY "${STAGING}" (${COLS.join(",")}) FROM STDIN WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N')`,
  ));
  await pipeline(Readable.from([tsv]), stream);
  return rows.length;
}

async function flushStagingToMain() {
  // Move staged rows into main table, deduping by (country, phone_norm).
  // Rows without phone_norm always insert (no uniqueness there).
  const result = await setupClient.query(`
    WITH dedup AS (
      SELECT DISTINCT ON (country, phone_norm) *
      FROM "${STAGING}"
      WHERE phone_norm IS NOT NULL
      ORDER BY country, phone_norm
    )
    INSERT INTO public.fb_people_db
      (country,fbid,phone_norm,phone_raw,first_name,last_name,name_norm,email,
       gender,hometown,location,work,education,relationship,religion,
       birthday,birthday_year,locale,about_me)
    SELECT country,fbid,phone_norm,phone_raw,first_name,last_name,name_norm,email,
       gender,hometown,location,work,education,relationship,religion,
       birthday,birthday_year,locale,about_me
    FROM dedup
    ON CONFLICT (country, phone_norm) WHERE phone_norm IS NOT NULL DO NOTHING;
  `);
  const inserted1 = result.rowCount || 0;
  const r2 = await setupClient.query(`
    INSERT INTO public.fb_people_db
      (country,fbid,phone_norm,phone_raw,first_name,last_name,name_norm,email,
       gender,hometown,location,work,education,relationship,religion,
       birthday,birthday_year,locale,about_me)
    SELECT country,fbid,phone_norm,phone_raw,first_name,last_name,name_norm,email,
       gender,hometown,location,work,education,relationship,religion,
       birthday,birthday_year,locale,about_me
    FROM "${STAGING}"
    WHERE phone_norm IS NULL;
  `);
  const inserted2 = r2.rowCount || 0;
  await setupClient.query(`TRUNCATE "${STAGING}"`);
  return inserted1 + inserted2;
}

async function readRange(lo, hi) {
  // Try the full range. On corruption error, halve recursively; on a 1-row
  // range that fails, skip it.
  try {
    return sqlite.prepare("SELECT * FROM data WHERE id BETWEEN ? AND ?").all(lo, hi);
  } catch (err) {
    if (lo >= hi) {
      console.warn(`  [skip] id=${lo} corrupt: ${err.message}`);
      return [];
    }
    const mid = Math.floor((lo + hi) / 2);
    const a = await readRange(lo, mid);
    const b = await readRange(mid + 1, hi);
    return a.concat(b);
  }
}

let totalRead = 0, totalInserted = 0, totalSkipped = 0;
const startWall = performance.now();
let stagedSinceFlush = 0;
const FLUSH_EVERY = 50000;

for (let lo = START_ID; lo <= maxId; lo += BATCH) {
  const hi = Math.min(lo + BATCH - 1, maxId);
  const t0 = performance.now();
  const rows = await readRange(lo, hi);
  if (rows.length === 0) {
    totalSkipped += hi - lo + 1;
    continue;
  }
  const copied = await copyBatch(rows);
  totalRead += copied;
  stagedSinceFlush += copied;

  if (stagedSinceFlush >= FLUSH_EVERY || hi === maxId) {
    const ins = await flushStagingToMain();
    totalInserted += ins;
    stagedSinceFlush = 0;
  }

  const dt = ((performance.now() - t0) / 1000).toFixed(2);
  const pct = ((hi / maxId) * 100).toFixed(2);
  const rate = totalRead / ((performance.now() - startWall) / 1000);
  stdout.write(`\r[${pct}%] id=${hi}/${maxId}  read=${totalRead}  inserted=${totalInserted}  rate=${rate.toFixed(0)}/s  last=${dt}s    `);
}

stdout.write("\n");
console.log(`[done] country=${COUNTRY} read=${totalRead} inserted=${totalInserted} skipped_ids=${totalSkipped}`);
setupClient.release();
sqlite.close();
await pg.end();
