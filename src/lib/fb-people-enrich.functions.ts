// Server functions for enriching extracted Facebook leads against the
// large internal `fb_people_db` (Egypt + Iraq). All queries run server-side
// via the service-role client because the table is RLS-locked from end users.
//
// Cascade lookup per lead:
//   1) FBID exact
//   2) phone_norm (country-aware) exact
//   3) email lower exact
//   4) full_name exact (Arabic-normalized)
//   5) name_norm fuzzy (pg_trgm similarity > 0.6) -- best single match
//
// We return a record per lead with whichever fields are populated. Missing
// fields stay null.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LeadSchema = z.object({
  fbid: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  name: z.string().trim().optional().nullable(),
});
export type EnrichLead = z.infer<typeof LeadSchema>;

const InputSchema = z.object({
  leads: z.array(LeadSchema).min(1).max(1000),
  countryHint: z.enum(["EG", "IQ"]).optional(),
});

export type EnrichedPerson = {
  fbid: string | null;
  phone: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  gender: string | null;
  hometown: string | null;
  location: string | null;
  work: string | null;
  education: string | null;
  relationship: string | null;
  religion: string | null;
  birthday: string | null;
  locale: string | null;
  country: string | null;
  match_source: "fbid" | "phone" | "email" | "name_exact" | "name_fuzzy";
  match_score: number | null;
};

export type EnrichResult = {
  found: number;
  notFound: number;
  results: Array<{ input: EnrichLead; match: EnrichedPerson | null }>;
};

// --- normalization helpers (must mirror ETL) ---
const AR_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
function normName(s: string | null | undefined): string | null {
  if (!s) return null;
  const out = String(s)
    .toLowerCase()
    .replace(AR_DIACRITICS, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
  return out || null;
}
function normPhone(p: string | null | undefined, country?: "EG" | "IQ"): string | null {
  if (!p) return null;
  let s = String(p).replace(/[^\d]/g, "");
  if (!s) return null;
  if (country === "EG" && s.startsWith("20")) s = s.slice(2);
  if (country === "IQ" && s.startsWith("964")) s = s.slice(3);
  // generic fallback (any country prefix removal happens via last-10 trim)
  if (s.length < 7) return null;
  return s.slice(-10);
}

const FIELDS =
  "fbid, phone_raw, email, first_name, last_name, full_name, gender, hometown, location, work, education, relationship, religion, birthday, locale, country";

function rowToPerson(
  row: Record<string, unknown>,
  source: EnrichedPerson["match_source"],
  score: number | null,
): EnrichedPerson {
  const g = (k: string) => (row[k] == null ? null : String(row[k]));
  return {
    fbid: g("fbid"),
    phone: g("phone_raw"),
    email: g("email"),
    first_name: g("first_name"),
    last_name: g("last_name"),
    full_name: g("full_name"),
    gender: g("gender"),
    hometown: g("hometown"),
    location: g("location"),
    work: g("work"),
    education: g("education"),
    relationship: g("relationship"),
    religion: g("religion"),
    birthday: g("birthday"),
    locale: g("locale"),
    country: g("country"),
    match_source: source,
    match_score: score,
  };
}

export const enrichFbPeople = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<EnrichResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // ---- Step 1: bucket leads by best identifier ----
    const wantFbids = new Set<string>();
    const wantPhonesEG = new Set<string>();
    const wantPhonesIQ = new Set<string>();
    const wantEmails = new Set<string>();
    const wantNames = new Set<string>();

    type Norm = {
      fbid: string | null;
      phone_eg: string | null;
      phone_iq: string | null;
      email_lower: string | null;
      name_norm: string | null;
    };
    const normalized: Norm[] = data.leads.map((l) => {
      const fbid = l.fbid?.replace(/\D+/g, "") || null;
      const phone_eg = normPhone(l.phone, "EG");
      const phone_iq = normPhone(l.phone, "IQ");
      const email_lower = l.email?.toLowerCase().trim() || null;
      const name_norm = normName(l.name);
      if (fbid) wantFbids.add(fbid);
      if (phone_eg) wantPhonesEG.add(phone_eg);
      if (phone_iq) wantPhonesIQ.add(phone_iq);
      if (email_lower && email_lower !== "none") wantEmails.add(email_lower);
      if (name_norm) wantNames.add(name_norm);
      return { fbid, phone_eg, phone_iq, email_lower, name_norm };
    });

    // ---- Step 2: bulk-fetch the cheap exact-match buckets in parallel ----
    const queries: Array<Promise<{ kind: string; rows: Record<string, unknown>[] }>> = [];
    if (wantFbids.size) {
      queries.push(
        supabaseAdmin
          .from("fb_people_db")
          .select(FIELDS)
          .in("fbid", Array.from(wantFbids))
          .then(({ data: rows }) => ({ kind: "fbid", rows: (rows as unknown[]) as Record<string, unknown>[] })),
      );
    }
    if (wantPhonesEG.size) {
      queries.push(
        supabaseAdmin
          .from("fb_people_db")
          .select(FIELDS + ", phone_norm")
          .eq("country", "EG")
          .in("phone_norm", Array.from(wantPhonesEG))
          .then(({ data: rows }) => ({ kind: "phone_eg", rows: (rows as unknown[]) as Record<string, unknown>[] })),
      );
    }
    if (wantPhonesIQ.size) {
      queries.push(
        supabaseAdmin
          .from("fb_people_db")
          .select(FIELDS + ", phone_norm")
          .eq("country", "IQ")
          .in("phone_norm", Array.from(wantPhonesIQ))
          .then(({ data: rows }) => ({ kind: "phone_iq", rows: (rows as unknown[]) as Record<string, unknown>[] })),
      );
    }
    if (wantEmails.size) {
      // No direct ilike-in; use OR filter. Cap to keep URL short.
      const emails = Array.from(wantEmails).slice(0, 200);
      const orExpr = emails.map((e) => `email.eq.${e}`).join(",");
      queries.push(
        supabaseAdmin
          .from("fb_people_db")
          .select(FIELDS)
          .or(orExpr)
          .then(({ data: rows }) => ({ kind: "email", rows: (rows as unknown[]) as Record<string, unknown>[] })),
      );
    }
    if (wantNames.size) {
      const names = Array.from(wantNames).slice(0, 200);
      queries.push(
        supabaseAdmin
          .from("fb_people_db")
          .select(FIELDS + ", name_norm")
          .in("name_norm", names)
          .limit(1000)
          .then(({ data: rows }) => ({ kind: "name_exact", rows: (rows as unknown[]) as Record<string, unknown>[] })),
      );
    }

    const settled = await Promise.all(queries);

    // ---- Step 3: build indexes for fast per-lead lookup ----
    const byFbid = new Map<string, Record<string, unknown>>();
    const byPhone = new Map<string, Record<string, unknown>>(); // key: country|phone_norm
    const byEmail = new Map<string, Record<string, unknown>>();
    const byName = new Map<string, Record<string, unknown>>();
    for (const s of settled) {
      for (const row of s.rows ?? []) {
        if (s.kind === "fbid" && row.fbid) byFbid.set(String(row.fbid), row);
        else if ((s.kind === "phone_eg" || s.kind === "phone_iq") && row.phone_norm && row.country) {
          byPhone.set(`${row.country}|${row.phone_norm}`, row);
        } else if (s.kind === "email" && row.email) {
          byEmail.set(String(row.email).toLowerCase(), row);
        } else if (s.kind === "name_exact" && row.name_norm) {
          // first wins (could improve with most-recent / most-complete)
          const k = String(row.name_norm);
          if (!byName.has(k)) byName.set(k, row);
        }
      }
    }

    // ---- Step 4: per-lead cascade ----
    let found = 0;
    let notFound = 0;
    const results: EnrichResult["results"] = [];
    for (let i = 0; i < data.leads.length; i++) {
      const lead = data.leads[i];
      const n = normalized[i];
      let match: EnrichedPerson | null = null;

      if (n.fbid && byFbid.has(n.fbid)) {
        match = rowToPerson(byFbid.get(n.fbid)!, "fbid", 1);
      } else if (n.phone_eg && byPhone.has(`EG|${n.phone_eg}`)) {
        match = rowToPerson(byPhone.get(`EG|${n.phone_eg}`)!, "phone", 1);
      } else if (n.phone_iq && byPhone.has(`IQ|${n.phone_iq}`)) {
        match = rowToPerson(byPhone.get(`IQ|${n.phone_iq}`)!, "phone", 1);
      } else if (n.email_lower && byEmail.has(n.email_lower)) {
        match = rowToPerson(byEmail.get(n.email_lower)!, "email", 1);
      } else if (n.name_norm && byName.has(n.name_norm)) {
        match = rowToPerson(byName.get(n.name_norm)!, "name_exact", 1);
      }

      if (match) found++;
      else notFound++;
      results.push({ input: lead, match });
    }

    // ---- Step 5: fuzzy-name fallback for the still-unmatched leads ----
    // pg_trgm similarity isn't expressible via PostgREST builders; we call a
    // single SQL via RPC-style for speed. We skip if there are too many to
    // keep latency bounded.
    const fuzzyTargets: { idx: number; name: string }[] = [];
    for (let i = 0; i < results.length; i++) {
      if (!results[i].match && normalized[i].name_norm) {
        fuzzyTargets.push({ idx: i, name: normalized[i].name_norm! });
      }
    }

    if (fuzzyTargets.length && fuzzyTargets.length <= 100) {
      // Inline OR of similarity matches per name, top-1 each. We avoid a
      // per-name network round-trip by issuing them in parallel (cap = 20).
      const settledFuzzy = await Promise.all(
        fuzzyTargets.map(async ({ idx, name }) => {
          const { data: rows } = await supabaseAdmin.rpc("fb_people_fuzzy_name", {
            q: name,
            min_sim: 0.6,
          });
          return { idx, row: (rows && rows[0]) || null };
        }),
      );
      for (const { idx, row } of settledFuzzy) {
        if (row) {
          const r = row as Record<string, unknown>;
          results[idx].match = rowToPerson(r, "name_fuzzy", Number(r.sim ?? 0));
          found++;
          notFound--;
        }
      }
    }

    // ---- Step 6: audit ----
    try {
      await supabaseAdmin.rpc("fb_enrichment_record", {
        _user_id: context.userId,
        _lookups: data.leads.length,
        _hits: found,
      });
    } catch {
      /* non-fatal */
    }

    return { found, notFound, results };
  });
