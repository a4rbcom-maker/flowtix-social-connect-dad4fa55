#!/usr/bin/env node
// ETL via HTTPS — Lovable Cloud edition.
// Reads the Egypt/Iraq SQLite databases on the VPS and POSTs normalized rows
// to /api/public/fb-people-ingest (uses supabaseAdmin server-side).
//
// Usage:
//   export FB_INGEST_URL="https://flowtix-social-connect.lovable.app"
//   export FB_INGEST_SECRET="<value of FB_PEOPLE_INGEST_SECRET secret>"
//
//   node scripts/etl-fb-people-db-http.mjs --country=EG --sqlite=/home/khaled/superdata/egypt.db
//   node scripts/etl-fb-people-db-http.mjs --country=IQ --sqlite=/home/khaled/superdata/Iraq.db
//   node scripts/etl-fb-people-db-http.mjs --post-index
//
// Install once on the VPS:
//   npm i -D better-sqlite3
//
// Resumable: pass --start=<lastId+1> to continue after an interruption.

import { argv, exit, env, stdout } from "node:process";
import { performance } from "node:perf_hooks";

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
const BATCH = Number(args.batch || 1500);
const START_ID = Number(args.start || 1);
const END_ID = args.end ? Number(args.end) : Infinity;
const CONCURRENCY = Number(args.concurrency || 3);

const INGEST_URL = env.FB_INGEST_URL;
const INGEST_SECRET = env.FB_INGEST_SECRET;
if (!INGEST_URL || !INGEST_SECRET) {
  console.error("ERROR: set FB_INGEST_URL and FB_INGEST_SECRET env vars.");
  exit(2);
}
const ENDPOINT = `${INGEST_URL.replace(/\/$/, "")}/api/public/fb-people-ingest`;

let Database;
try {
  Database = (await import("better-sqlite3")).default;
} catch (e) {
  console.error("Missing dep. Run:  npm i -D better-sqlite3\n", e?.message || e);
  exit(2);
}

// ---- normalization ----
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
  if (country === "EG" && s.startsWith("20")) s = s.slice(2);
  if (country === "IQ" && s.startsWith("964")) s = s.slice(3);
  if (s.length < 7) return null;
  return s.slice(-10);
}
const AR_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
function normName(first, last) {
  const joined = `${first || ""} ${last || ""}`.trim();
  if (!joined) return null;
  return (
    joined
      .toLowerCase()
      .replace(AR_DIACRITICS, "")
      .replace(/[إأآا]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/\s+/g, " ")
      .trim() || null
  );
}

function toRow(country, r) {
  const first = nz(r.first_name);
  const last = nz(r.last_name);
  return {
    country,
    fbid: nz(r.FBID),
    phone_norm: normPhone(r.Phone, country),
    phone_raw: nz(r.Phone),
    first_name: first,
    last_name: last,
    name_norm: normName(first, last),
    email: nz(r.email),
    gender: nz(r.gender),
    hometown: nz(r.hometown),
    location: nz(r.location),
    work: nz(r.work),
    education: nz(r.education),
    relationship: nz(r.relationship),
    religion: nz(r.religion),
    birthday: nz(r.birthday),
    birthday_year: nz(r.birthdayYear),
    locale: nz(r.locale),
    about_me: nz(r.about_me),
  };
}

async function postBatch(rows, attempt = 1) {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ingest-secret": INGEST_SECRET },
      body: JSON.stringify({ rows }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    return json.inserted || 0;
  } catch (err) {
    if (attempt >= 4) throw err;
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return postBatch(rows, attempt + 1);
  }
}

if (POST_INDEX) {
  console.log("[post-index] requesting GIN trigram index build...");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ingest-secret": INGEST_SECRET },
    body: JSON.stringify({ op: "post_index" }),
  });
  console.log("[post-index] HTTP", res.status, await res.text());
  exit(res.ok ? 0 : 1);
}

if (!COUNTRY || !["EG", "IQ"].includes(COUNTRY)) {
  console.error("ERROR: --country must be EG or IQ");
  exit(2);
}
if (!SQLITE_PATH) {
  console.error("ERROR: --sqlite=/path/to/file.db is required");
  exit(2);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
sqlite.pragma("journal_mode = OFF");
sqlite.pragma("synchronous = OFF");

let maxId = END_ID;
try {
  const r = sqlite.prepare("SELECT MAX(id) AS m FROM data").get();
  if (r && r.m) maxId = Math.min(END_ID, r.m);
} catch {
  try {
    const r = sqlite.prepare("SELECT seq AS m FROM sqlite_sequence WHERE name='data'").get();
    if (r && r.m) maxId = Math.min(END_ID, r.m);
  } catch {}
}
console.log(`[import] country=${COUNTRY} sqlite=${SQLITE_PATH} ids=${START_ID}..${maxId} batch=${BATCH} concurrency=${CONCURRENCY}`);

function readRange(lo, hi) {
  try {
    return sqlite.prepare("SELECT * FROM data WHERE id BETWEEN ? AND ?").all(lo, hi);
  } catch (err) {
    if (lo >= hi) {
      console.warn(`\n  [skip] id=${lo} corrupt: ${err.message}`);
      return [];
    }
    const mid = Math.floor((lo + hi) / 2);
    return readRange(lo, mid).concat(readRange(mid + 1, hi));
  }
}

let totalRead = 0;
let totalInserted = 0;
let totalSkipped = 0;
let lastFlushedId = START_ID - 1;
const startWall = performance.now();

// Simple concurrency window: keep N in-flight POSTs.
const inFlight = new Set();
async function dispatch(rows, hi) {
  const p = postBatch(rows)
    .then((ins) => {
      totalInserted += ins;
      lastFlushedId = Math.max(lastFlushedId, hi);
    })
    .catch((err) => {
      console.error(`\n  [error] batch ending id=${hi} failed: ${err.message}`);
    })
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
  if (inFlight.size >= CONCURRENCY) await Promise.race(inFlight);
}

for (let lo = START_ID; lo <= maxId; lo += BATCH) {
  const hi = Math.min(lo + BATCH - 1, maxId);
  const raw = readRange(lo, hi);
  if (raw.length === 0) {
    totalSkipped += hi - lo + 1;
    continue;
  }
  const rows = raw.map((r) => toRow(COUNTRY, r));
  totalRead += rows.length;
  await dispatch(rows, hi);

  const dt = (performance.now() - startWall) / 1000;
  const pct = ((hi / maxId) * 100).toFixed(2);
  const rate = (totalRead / dt).toFixed(0);
  stdout.write(
    `\r[${pct}%] id=${hi}/${maxId}  read=${totalRead}  inserted=${totalInserted}  rate=${rate}/s  flushed_to=${lastFlushedId}    `,
  );
}

await Promise.all(inFlight);
stdout.write("\n");
console.log(`[done] country=${COUNTRY} read=${totalRead} inserted=${totalInserted} skipped_ids=${totalSkipped} last_id=${lastFlushedId}`);
sqlite.close();
