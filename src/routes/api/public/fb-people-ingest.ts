import { createFileRoute } from "@tanstack/react-router";

// Bulk ingest endpoint for the Egypt/Iraq Facebook people SQLite databases.
// Used by scripts/etl-fb-people-db-http.mjs which streams pre-normalized
// JSON batches (max ~5000 rows). Auth via shared secret FB_PEOPLE_INGEST_SECRET.
//
// Supported ops:
//   (default)      – insert a batch of rows (with per-row sanity checks).
//   "preflight"    – return current row counts per country + endpoint version.
//                    Used by the ETL script before starting to verify the
//                    endpoint is reachable, secret is valid, and DB is healthy.
//   "verify"       – return current row counts per country. Used after the
//                    import finishes to confirm deltas match expectations.
//   "post_index"   – rebuild the GIN trigram index once loading is complete.

type IngestRow = {
  country: string;
  fbid: string | null;
  phone_norm: string | null;
  phone_raw: string | null;
  first_name: string | null;
  last_name: string | null;
  name_norm: string | null;
  email: string | null;
  gender: string | null;
  hometown: string | null;
  location: string | null;
  work: string | null;
  education: string | null;
  relationship: string | null;
  religion: string | null;
  birthday: string | null;
  birthday_year: string | null;
  locale: string | null;
  about_me: string | null;
};

const ALLOWED_COUNTRIES = new Set(["EG", "IQ"]);
const MAX_STR = 2000;
const MAX_NAME = 200;

type Op = "insert" | "post_index" | "preflight" | "verify";

// ---- row-level sanity check --------------------------------------------------
// Returns null on OK, or a human-readable reason string on failure.
function validateRow(r: unknown, i: number): string | null {
  if (!r || typeof r !== "object") return `row[${i}]: not an object`;
  const row = r as Record<string, unknown>;

  const country = row.country;
  if (typeof country !== "string" || !ALLOWED_COUNTRIES.has(country)) {
    return `row[${i}]: invalid country "${String(country)}"`;
  }

  // At least one identifying field must exist — reject pure-empty rows so
  // we never store useless records.
  const hasAnyId =
    (typeof row.fbid === "string" && row.fbid) ||
    (typeof row.phone_norm === "string" && row.phone_norm) ||
    (typeof row.name_norm === "string" && row.name_norm) ||
    (typeof row.email === "string" && row.email);
  if (!hasAnyId) return `row[${i}]: empty row (no fbid/phone/name/email)`;

  if (row.fbid != null) {
    if (typeof row.fbid !== "string") return `row[${i}]: fbid must be string`;
    if (row.fbid.length > 40 || !/^\d+$/.test(row.fbid)) {
      return `row[${i}]: fbid not digits or too long`;
    }
  }
  if (row.phone_norm != null) {
    if (typeof row.phone_norm !== "string") return `row[${i}]: phone_norm must be string`;
    if (!/^\d{7,15}$/.test(row.phone_norm)) {
      return `row[${i}]: phone_norm shape invalid`;
    }
  }
  if (row.email != null && typeof row.email === "string") {
    if (row.email.length > 320) return `row[${i}]: email too long`;
  }
  if (row.name_norm != null && typeof row.name_norm === "string") {
    if (row.name_norm.length > MAX_NAME) return `row[${i}]: name_norm too long`;
  }

  // Generic string-length guard against runaway payloads
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && v.length > MAX_STR) {
      return `row[${i}]: field "${k}" exceeds ${MAX_STR} chars`;
    }
  }
  return null;
}

async function countByCountry(
  admin: Awaited<ReturnType<typeof getAdmin>>,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const c of ALLOWED_COUNTRIES) {
    const { count, error } = await admin
      .from("fb_people_db")
      .select("*", { count: "exact", head: true })
      .eq("country", c);
    if (error) throw new Error(`count ${c} failed: ${error.message}`);
    out[c] = count ?? 0;
  }
  return out;
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const Route = createFileRoute("/api/public/fb-people-ingest")({
  component: () => null,
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = request.headers.get("x-ingest-secret");
        const expected = process.env.FB_PEOPLE_INGEST_SECRET;
        if (!expected || !secret || secret !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: { rows?: IngestRow[]; op?: Op; country?: string } | null = null;
        try {
          payload = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const admin = await getAdmin();

        // ---- preflight: verify endpoint + DB health -----------------------
        if (payload?.op === "preflight" || payload?.op === "verify") {
          try {
            const counts = await countByCountry(admin);
            return Response.json({
              ok: true,
              op: payload.op,
              endpoint_version: "2",
              counts,
              server_time: new Date().toISOString(),
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return Response.json({ ok: false, error: msg }, { status: 500 });
          }
        }

        // ---- post-index -----------------------------------------------------
        if (payload?.op === "post_index") {
          const { error } = await admin.rpc("fb_people_post_index" as never);
          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }
          return Response.json({ ok: true, indexed: true });
        }

        // ---- insert batch ---------------------------------------------------
        const rows = Array.isArray(payload?.rows) ? payload!.rows! : [];
        if (rows.length === 0) {
          return Response.json({ ok: true, inserted: 0, received: 0, rejected: 0 });
        }
        if (rows.length > 5000) {
          return new Response("Batch too large (max 5000)", { status: 413 });
        }

        // Per-row sanity: collect the first few offending rows and reject
        // the whole batch so the ETL can log + fix before continuing.
        const rejects: { i: number; reason: string }[] = [];
        for (let i = 0; i < rows.length; i++) {
          const reason = validateRow(rows[i], i);
          if (reason) {
            rejects.push({ i, reason });
            if (rejects.length >= 10) break;
          }
        }
        if (rejects.length > 0) {
          return Response.json(
            {
              ok: false,
              error: "row validation failed",
              rejected_sample: rejects,
              received: rows.length,
            },
            { status: 422 },
          );
        }

        // Split rows by whether they have phone_norm — the unique index only
        // covers rows where phone_norm IS NOT NULL.
        const withPhone = rows.filter((r) => r.phone_norm);
        const noPhone = rows.filter((r) => !r.phone_norm);

        let inserted = 0;
        const perCountryBefore: Record<string, number> = {};
        const touched = new Set(rows.map((r) => r.country));
        for (const c of touched) {
          const { count } = await admin
            .from("fb_people_db")
            .select("*", { count: "exact", head: true })
            .eq("country", c);
          perCountryBefore[c] = count ?? 0;
        }

        if (withPhone.length) {
          // Dedupe within the batch on (country, phone_norm) to avoid
          // "cannot affect row a second time" upsert errors.
          const map = new Map<string, IngestRow>();
          for (const r of withPhone) {
            map.set(`${r.country}|${r.phone_norm}`, r);
          }
          const deduped = Array.from(map.values());
          const { error, count } = await admin
            .from("fb_people_db")
            .upsert(deduped, {
              onConflict: "country,phone_norm",
              ignoreDuplicates: true,
              count: "estimated",
            });
          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }
          inserted += count ?? deduped.length;
        }

        if (noPhone.length) {
          const { error, count } = await admin
            .from("fb_people_db")
            .insert(noPhone, { count: "estimated" });
          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }
          inserted += count ?? noPhone.length;
        }

        // Post-write consistency delta (server-side) — helps the ETL detect
        // silent drops even when the driver reports OK.
        const perCountryAfter: Record<string, number> = {};
        for (const c of touched) {
          const { count } = await admin
            .from("fb_people_db")
            .select("*", { count: "exact", head: true })
            .eq("country", c);
          perCountryAfter[c] = count ?? 0;
        }
        const delta: Record<string, number> = {};
        for (const c of touched) {
          delta[c] = (perCountryAfter[c] ?? 0) - (perCountryBefore[c] ?? 0);
        }

        return Response.json({
          ok: true,
          inserted,
          received: rows.length,
          delta,
          counts_after: perCountryAfter,
        });
      },
    },
  },
});
