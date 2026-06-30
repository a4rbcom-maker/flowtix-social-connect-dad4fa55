import { createFileRoute } from "@tanstack/react-router";

// Bulk ingest endpoint for the Egypt/Iraq Facebook people SQLite databases.
// Used by scripts/etl-fb-people-db-http.mjs which streams pre-normalized
// JSON batches (max ~2000 rows). Auth via shared secret FB_PEOPLE_INGEST_SECRET.

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

        let payload: { rows?: IngestRow[]; op?: "insert" | "post_index" } | null = null;
        try {
          payload = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Optional post-index op: builds the trigram GIN index once after all rows are loaded.
        if (payload?.op === "post_index") {
          const { error } = await supabaseAdmin.rpc("fb_people_post_index" as never);
          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }
          return Response.json({ ok: true, indexed: true });
        }

        const rows = Array.isArray(payload?.rows) ? payload!.rows! : [];
        if (rows.length === 0) {
          return Response.json({ ok: true, inserted: 0 });
        }
        if (rows.length > 5000) {
          return new Response("Batch too large (max 5000)", { status: 413 });
        }

        // Split rows by whether they have phone_norm — the unique index only
        // covers rows where phone_norm IS NOT NULL.
        const withPhone = rows.filter((r) => r.phone_norm);
        const noPhone = rows.filter((r) => !r.phone_norm);

        let inserted = 0;

        if (withPhone.length) {
          // Dedupe within the batch on (country, phone_norm) to avoid
          // "cannot affect row a second time" upsert errors.
          const map = new Map<string, IngestRow>();
          for (const r of withPhone) {
            map.set(`${r.country}|${r.phone_norm}`, r);
          }
          const deduped = Array.from(map.values());
          const { error, count } = await supabaseAdmin
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
          const { error, count } = await supabaseAdmin
            .from("fb_people_db")
            .insert(noPhone, { count: "estimated" });
          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }
          inserted += count ?? noPhone.length;
        }

        return Response.json({ ok: true, inserted, received: rows.length });
      },
    },
  },
});
