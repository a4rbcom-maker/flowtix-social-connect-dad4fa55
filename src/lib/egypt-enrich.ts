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
    // strip leading "ال" article so "القاهره" matches "قاهره"
    .replace(/\s+/g, " ")
    .trim();
}

// Common Arabic city/town names that aren't in the transliterated dataset.
// Each maps directly to its governorate so users typing Arabic get a hit.
const ARABIC_CITY_ALIASES: { city: string; gov: string }[] = [
  { city: "القاهرة", gov: "القاهرة" }, { city: "مدينة نصر", gov: "القاهرة" },
  { city: "المعادي", gov: "القاهرة" }, { city: "مصر الجديدة", gov: "القاهرة" },
  { city: "حلوان", gov: "القاهرة" }, { city: "شبرا", gov: "القاهرة" },
  { city: "الإسكندرية", gov: "الإسكندرية" }, { city: "اسكندرية", gov: "الإسكندرية" },
  { city: "العامرية", gov: "الإسكندرية" }, { city: "برج العرب", gov: "الإسكندرية" },
  { city: "الجيزة", gov: "الجيزة" }, { city: "6 أكتوبر", gov: "الجيزة" },
  { city: "السادس من أكتوبر", gov: "الجيزة" }, { city: "الشيخ زايد", gov: "الجيزة" },
  { city: "الهرم", gov: "الجيزة" }, { city: "فيصل", gov: "الجيزة" },
  { city: "إمبابة", gov: "الجيزة" }, { city: "العياط", gov: "الجيزة" },
  { city: "الزقازيق", gov: "الشرقية" }, { city: "بلبيس", gov: "الشرقية" },
  { city: "العاشر من رمضان", gov: "الشرقية" }, { city: "ههيا", gov: "الشرقية" },
  { city: "المنصورة", gov: "الدقهلية" }, { city: "ميت غمر", gov: "الدقهلية" },
  { city: "طلخا", gov: "الدقهلية" }, { city: "السنبلاوين", gov: "الدقهلية" },
  { city: "طنطا", gov: "الغربية" }, { city: "المحلة الكبرى", gov: "الغربية" },
  { city: "كفر الزيات", gov: "الغربية" }, { city: "زفتى", gov: "الغربية" },
  { city: "شبين الكوم", gov: "المنوفية" }, { city: "السادات", gov: "المنوفية" },
  { city: "منوف", gov: "المنوفية" }, { city: "بنها", gov: "القليوبية" },
  { city: "شبرا الخيمة", gov: "القليوبية" }, { city: "القناطر الخيرية", gov: "القليوبية" },
  { city: "العبور", gov: "القليوبية" }, { city: "كفر الشيخ", gov: "كفر الشيخ" },
  { city: "دسوق", gov: "كفر الشيخ" }, { city: "دمياط", gov: "دمياط" },
  { city: "رأس البر", gov: "دمياط" }, { city: "بورسعيد", gov: "بورسعيد" },
  { city: "الإسماعيلية", gov: "الإسماعيلية" }, { city: "فايد", gov: "الإسماعيلية" },
  { city: "السويس", gov: "السويس" }, { city: "العين السخنة", gov: "السويس" },
  { city: "الفيوم", gov: "الفيوم" }, { city: "بني سويف", gov: "بني سويف" },
  { city: "المنيا", gov: "المنيا" }, { city: "ملوي", gov: "المنيا" },
  { city: "أسيوط", gov: "أسيوط" }, { city: "سوهاج", gov: "سوهاج" },
  { city: "أخميم", gov: "سوهاج" }, { city: "جرجا", gov: "سوهاج" },
  { city: "قنا", gov: "قنا" }, { city: "نجع حمادي", gov: "قنا" },
  { city: "الأقصر", gov: "الأقصر" }, { city: "إسنا", gov: "الأقصر" },
  { city: "أسوان", gov: "أسوان" }, { city: "كوم أمبو", gov: "أسوان" },
  { city: "الغردقة", gov: "البحر الأحمر" }, { city: "سفاجا", gov: "البحر الأحمر" },
  { city: "مرسى علم", gov: "البحر الأحمر" }, { city: "شرم الشيخ", gov: "جنوب سيناء" },
  { city: "دهب", gov: "جنوب سيناء" }, { city: "نويبع", gov: "جنوب سيناء" },
  { city: "العريش", gov: "شمال سيناء" }, { city: "رفح", gov: "شمال سيناء" },
  { city: "مطروح", gov: "مطروح" }, { city: "مرسى مطروح", gov: "مطروح" },
  { city: "سيوة", gov: "مطروح" }, { city: "دمنهور", gov: "البحيرة" },
  { city: "كفر الدوار", gov: "البحيرة" }, { city: "إدكو", gov: "البحيرة" },
  { city: "رشيد", gov: "البحيرة" }, { city: "الخارجة", gov: "الوادي الجديد" },
  { city: "الداخلة", gov: "الوادي الجديد" },
];

export async function loadEgyptData(): Promise<EgyptDataset> {
  if (cached) return cached;
  if (loading) return loading;
  loading = import("@/data/egypt-locations.json").then((m) => {
    cached = m.default as EgyptDataset;
    // Build a combined searchable list: aliases + governorates + dataset cities.
    // Sort by normalized length DESC so longest match wins (e.g. "مدينة نصر"
    // matches before "نصر").
    const all = [
      ...ARABIC_CITY_ALIASES.map((c) => ({ city: c.city, cityNorm: normalize(c.city), gov: c.gov })),
      ...cached.governorates.map((g) => ({ city: g, cityNorm: normalize(g), gov: g })),
      ...cached.cities.map((c) => ({ city: c.city, cityNorm: normalize(c.city), gov: c.gov })),
    ];
    cachedNorm = all.sort((a, b) => b.cityNorm.length - a.cityNorm.length);
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
  return normalizePhone(m[0]);
}

function normalizePhone(raw: string): string {
  let r = raw.replace(/[\s-]/g, "");
  if (r.startsWith("+20")) r = "0" + r.slice(3);
  else if (r.startsWith("20") && r.length === 12) r = "0" + r.slice(2);
  return r;
}

/** Extract ALL unique Egyptian mobile numbers found in arbitrary text. */
export function extractAllEgyptPhones(text: string): string[] {
  if (!text) return [];
  const cleaned = text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const matches = cleaned.match(PHONE_RX);
  if (!matches) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const n = normalizePhone(m);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}


export function detectLocation(text: string): EgyptLocation | null {
  if (!cachedNorm || !text) return null;
  const t = " " + normalize(text) + " ";
  // cachedNorm is sorted by length desc, so the first hit is the longest match.
  for (const row of cachedNorm) {
    if (row.cityNorm.length < 3) continue;
    // Substring match (not word-boundary): Arabic text often has the city
    // glued to prepositions like "من" or "في" with no separator.
    if (t.includes(row.cityNorm)) {
      return { city: row.city, gov: row.gov };
    }
  }
  return null;
}

export type EnrichedLead = {
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  governorate: string | null;
  raw: string;
};

// Email regex (RFC-lite, good enough for lead text).
const EMAIL_RX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function extractEmail(text: string): string | null {
  if (!text) return null;
  const m = text.match(EMAIL_RX);
  return m && m[0] ? m[0].toLowerCase() : null;
}

// Best-effort name extraction: first line / first 6 words minus phone/email.
function extractName(text: string): string | null {
  const firstLine = text.split(/[\n\r|,;:]/)[0]?.trim();
  if (!firstLine) return null;
  const woPhone = firstLine
    .replace(PHONE_RX, "")
    .replace(EMAIL_RX, "")
    .replace(/[٠-٩]/g, "")
    .trim();
  const words = woPhone.split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  return words.length >= 2 ? words : null;
}

export function enrichLine(line: string): EnrichedLead {
  const phone = extractEgyptPhone(line);
  const email = extractEmail(line);
  const loc = detectLocation(line);
  return {
    name: extractName(line),
    phone,
    email,
    city: loc?.city ?? null,
    governorate: loc?.gov ?? null,
    raw: line,
  };
}

export async function enrichLines(lines: string[]): Promise<EnrichedLead[]> {
  await loadEgyptData();
  return lines.map((l) => enrichLine(l));
}
