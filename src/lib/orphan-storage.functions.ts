// Report-only orphan storage scanner. Compares storage.objects entries in the
// wa-media / bulk-media / fb-media buckets against database references and
// returns a diff. NEVER deletes.
import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "./admin-middleware";

type BucketName = "wa-media" | "bulk-media" | "fb-media";
const BUCKETS: BucketName[] = ["wa-media", "bulk-media", "fb-media"];

type OrphanSample = {
  path: string;
  size_bytes: number | null;
  created_at: string | null;
};

type BucketReport = {
  bucket: BucketName;
  storage_object_count: number;
  storage_total_bytes: number;
  referenced_paths_count: number;
  orphan_count: number;
  orphan_total_bytes: number;
  missing_in_storage_count: number; // referenced by DB but no object
  orphan_sample: OrphanSample[];
  missing_sample: string[];
  note?: string;
};

type ScanResult = {
  generated_at: string;
  buckets: BucketReport[];
  total_orphan_bytes: number;
  total_orphan_count: number;
};

// Extract a storage path from any of the raw values we store in the DB.
function extractPath(bucket: BucketName, raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const value = raw.trim();
  const prefixes = [
    `${bucket}:`,
    `storage://${bucket}/`,
  ];
  for (const p of prefixes) {
    if (value.startsWith(p)) return value.slice(p.length).replace(/^\/+/, "");
  }
  // signed / public URL formats:
  //   .../storage/v1/object/{sign,public,authenticated}/<bucket>/<path>?token=...
  const marker = `/${bucket}/`;
  const idx = value.indexOf(marker);
  if (idx >= 0 && /\/storage\/v1\/object\//.test(value.slice(0, idx + marker.length))) {
    const tail = value.slice(idx + marker.length);
    const clean = tail.split("?")[0].split("#")[0];
    return clean.replace(/^\/+/, "") || null;
  }
  return null;
}

async function listStorageObjects(
  admin: any,
  bucket: BucketName,
): Promise<{ path: string; size: number | null; createdAt: string | null }[]> {
  const pageSize = 1000;
  let offset = 0;
  const out: { path: string; size: number | null; createdAt: string | null }[] = [];
  // storage.objects.name is the full path within the bucket.
  // Cap at 50k objects per scan to keep memory bounded.
  const HARD_CAP = 50_000;
  while (out.length < HARD_CAP) {
    const { data, error } = await admin
      .schema("storage")
      .from("objects")
      .select("name,metadata,created_at")
      .eq("bucket_id", bucket)
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`storage list failed for ${bucket}: ${error.message}`);
    const rows = (data ?? []) as Array<{ name: string; metadata: any; created_at: string | null }>;
    if (rows.length === 0) break;
    for (const r of rows) {
      const size = r.metadata && typeof r.metadata.size === "number" ? r.metadata.size : null;
      out.push({ path: r.name, size, createdAt: r.created_at });
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function collectReferencedPaths(admin: any, bucket: BucketName): Promise<Set<string>> {
  const set = new Set<string>();
  const pageSize = 1000;

  const push = (raw: unknown) => {
    const p = extractPath(bucket, raw);
    if (p) set.add(p);
  };

  if (bucket === "wa-media") {
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("wa_messages")
        .select("media_url")
        .not("media_url", "is", null)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`wa_messages read failed: ${error.message}`);
      const rows = (data ?? []) as Array<{ media_url: string | null }>;
      if (!rows.length) break;
      rows.forEach((r) => push(r.media_url));
      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }

  if (bucket === "bulk-media") {
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("bulk_jobs")
        .select("image_url,metadata")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`bulk_jobs read failed: ${error.message}`);
      const rows = (data ?? []) as Array<{ image_url: string | null; metadata: any }>;
      if (!rows.length) break;
      rows.forEach((r) => {
        push(r.image_url);
        if (r.metadata && typeof r.metadata === "object") {
          // best-effort: scan any string value inside metadata for a bucket URL
          for (const v of Object.values(r.metadata)) push(v);
        }
      });
      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }

  if (bucket === "fb-media") {
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("fb_media_assets")
        .select("storage_path,public_url")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`fb_media_assets read failed: ${error.message}`);
      const rows = (data ?? []) as Array<{ storage_path: string | null; public_url: string | null }>;
      if (!rows.length) break;
      rows.forEach((r) => {
        // storage_path is stored as the raw bucket path (no prefix), keep it as-is.
        if (r.storage_path) set.add(r.storage_path.replace(/^\/+/, ""));
        push(r.public_url);
      });
      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }

  return set;
}

export const scanOrphanStorage = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<ScanResult> => {
    const admin = (context as any).supabaseAdmin;

    const reports: BucketReport[] = [];
    let totalOrphanBytes = 0;
    let totalOrphanCount = 0;

    for (const bucket of BUCKETS) {
      try {
        const [objects, refs] = await Promise.all([
          listStorageObjects(admin, bucket),
          collectReferencedPaths(admin, bucket),
        ]);

        const storagePaths = new Set(objects.map((o) => o.path));
        const orphans = objects.filter((o) => !refs.has(o.path));
        const missing = Array.from(refs).filter((p) => !storagePaths.has(p));

        const orphanBytes = orphans.reduce((s, o) => s + (o.size ?? 0), 0);
        const totalBytes = objects.reduce((s, o) => s + (o.size ?? 0), 0);

        totalOrphanBytes += orphanBytes;
        totalOrphanCount += orphans.length;

        reports.push({
          bucket,
          storage_object_count: objects.length,
          storage_total_bytes: totalBytes,
          referenced_paths_count: refs.size,
          orphan_count: orphans.length,
          orphan_total_bytes: orphanBytes,
          missing_in_storage_count: missing.length,
          orphan_sample: orphans.slice(0, 25).map((o) => ({
            path: o.path,
            size_bytes: o.size,
            created_at: o.createdAt,
          })),
          missing_sample: missing.slice(0, 25),
        });
      } catch (err) {
        reports.push({
          bucket,
          storage_object_count: 0,
          storage_total_bytes: 0,
          referenced_paths_count: 0,
          orphan_count: 0,
          orphan_total_bytes: 0,
          missing_in_storage_count: 0,
          orphan_sample: [],
          missing_sample: [],
          note: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      generated_at: new Date().toISOString(),
      buckets: reports,
      total_orphan_bytes: totalOrphanBytes,
      total_orphan_count: totalOrphanCount,
    };
  });
