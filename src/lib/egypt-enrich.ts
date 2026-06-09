// Egypt leads enrichment utilities.
// Detects city/governorate by matching a free-text string against a curated
// Egyptian locations dataset, and extracts Egyptian mobile phone numbers.

export type EgyptLocation = { city: string; gov: string };
export type EgyptDataset = { governorates: string[]; cities: EgyptLocation[] };

let cached: EgyptDataset | null = null;
let cachedNorm: { city: string; cityNorm: string; gov: string }[] | null = null;
let loading: Promise<EgyptDataset> | null = null;

// Normalize Arabic + Latin text for tolerant matching.
function normalize(s: string): string {
  return s
    .toLowerCase()
    // Arabic diacritics
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    // alef variants
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

export async function loadEgyptData(): Promise<EgyptDataset> {
  if (cached) return cached;
  if (loading) return loading;
  loading = import("@/data/egypt-locations.json").then((m) => {
    cached = m.default as EgyptDataset;
    cachedNorm = cached.cities.map((c) => ({
      city: c.city,
      cityNorm: normalize(c.city),
      gov: c.gov,
    }));
    return cached;
  });
  return loading;
}

// Egyptian mobile pattern: +20 1[0125] XXXXXXXX  or  01[0125]XXXXXXXX
const PHONE_RX = /(?:\+?20[\s-]?|0)1[0125][\s-]?\d{3}[\s-]?\d{4}/g;

export function extractEgyptPhone(text: string): string | null {
  if (!text) return null;
  const cleaned = text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const m = cleaned.match(PHONE_RX);
  if (!m || m.length === 0) return null;
  let raw = m[0].replace(/[\s-]/g, "");
  if (raw.startsWith("+20")) raw = "0" + raw.slice(3);
  else if (raw.startsWith("20") && raw.length === 12) raw = "0" + raw.slice(2);
  return raw;
}

export function detectLocation(text: string): EgyptLocation | null {
  if (!cachedNorm || !text) return null;
  const t = " " + normalize(text) + " ";
  // cachedNorm is pre-sorted by length desc, so the first hit is the longest match.
  for (const row of cachedNorm) {
    if (row.cityNorm.length < 3) continue;
    if (t.includes(" " + row.cityNorm) || t.includes(row.cityNorm + " ")) {
      return { city: row.city, gov: row.gov };
    }
  }
  return null;
}

export type EnrichedLead = {
  name: string | null;
  phone: string | null;
  city: string | null;
  governorate: string | null;
  raw: string;
};

// Best-effort name extraction: the first line / first 6 words minus phone.
function extractName(text: string): string | null {
  const firstLine = text.split(/[\n\r|,;:]/)[0]?.trim();
  if (!firstLine) return null;
  const woPhone = firstLine.replace(PHONE_RX, "").replace(/[٠-٩]/g, "").trim();
  const words = woPhone.split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  return words.length >= 2 ? words : null;
}

export function enrichLine(line: string): EnrichedLead {
  const phone = extractEgyptPhone(line);
  const loc = detectLocation(line);
  return {
    name: extractName(line),
    phone,
    city: loc?.city ?? null,
    governorate: loc?.gov ?? null,
    raw: line,
  };
}

export async function enrichLines(lines: string[]): Promise<EnrichedLead[]> {
  await loadEgyptData();
  return lines.map((l) => enrichLine(l));
}
