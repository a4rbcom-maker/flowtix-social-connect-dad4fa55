// Personal customer database — upload, normalize and match leads.
import { supabase } from "@/integrations/supabase/client";

export type CustomerRow = {
  id?: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  governorate?: string | null;
  address?: string | null;
  fb_id?: string | null;
  fb_profile_url?: string | null;
  notes?: string | null;
};

// ----- Normalization -----
export function normalizeArabic(s: string): string {
  return (s || "")
    .toString()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

// Keep last 10 digits to align +20 / 0020 / 0 prefixes.
export function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  const digits = String(p).replace(/\D+/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

export function extractFbId(url?: string | null): string | null {
  if (!url) return null;
  const s = String(url).trim();
  // numeric id only
  if (/^\d{5,}$/.test(s)) return s;
  // profile.php?id=123
  const m1 = s.match(/[?&]id=(\d{5,})/);
  if (m1) return m1[1];
  // facebook.com/123456789
  const m2 = s.match(/facebook\.com\/(?:profile\.php\?id=)?(\d{5,})/i);
  if (m2) return m2[1];
  return null;
}

export function buildRow(input: CustomerRow & { user_id: string }) {
  const phone_norm = normalizePhone(input.phone);
  const name_norm = input.full_name ? normalizeArabic(input.full_name) : null;
  const fb_id = input.fb_id || extractFbId(input.fb_profile_url);
  return {
    user_id: input.user_id,
    full_name: input.full_name || null,
    phone: input.phone || null,
    phone_norm,
    email: input.email || null,
    city: input.city || null,
    governorate: input.governorate || null,
    address: input.address || null,
    fb_id: fb_id || null,
    fb_profile_url: input.fb_profile_url || null,
    name_norm,
    notes: input.notes || null,
  };
}

// ----- Column auto-detection -----
type MappableField = Exclude<keyof CustomerRow, "id">;
const HEADER_HINTS: Record<MappableField, string[]> = {
  full_name: ["name", "اسم", "الاسم", "full name", "client", "عميل"],
  phone: ["phone", "mobile", "tel", "موبايل", "رقم", "هاتف", "جوال", "تليفون", "whatsapp", "واتس"],
  email: ["email", "mail", "ايميل", "إيميل", "بريد"],
  city: ["city", "مدينة", "المدينة"],
  governorate: ["gov", "محافظة", "المحافظة"],
  address: ["address", "عنوان", "العنوان"],
  fb_id: ["fb_id", "facebook id", "فيسبوك ايدي", "fbid", "id"],
  fb_profile_url: ["fb", "facebook", "profile", "url", "link", "رابط", "فيسبوك", "بروفايل"],
  notes: ["note", "ملاحظات", "ملاحظة", "comment"],
};

export function autoMapHeaders(headers: string[]): Partial<Record<MappableField, string>> {
  const map: Partial<Record<MappableField, string>> = {};
  const normHeaders = headers.map((h) => ({ raw: h, norm: normalizeArabic(String(h)) }));
  (Object.keys(HEADER_HINTS) as MappableField[]).forEach((field) => {
    const hints = HEADER_HINTS[field].map(normalizeArabic);
    const hit = normHeaders.find((h) => hints.some((k: string) => h.norm.includes(k)));
    if (hit && !Object.values(map).includes(hit.raw)) map[field] = hit.raw;
  });
  return map;
}

// ----- Match leads against the personal DB -----
export type LeadInput = {
  raw: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  fb_id?: string | null;
  fb_profile_url?: string | null;
};

export type MatchResult = CustomerRow & {
  matched_by?: "fb_id" | "phone" | "email" | "name";
};

/** Look up all customer rows for the current user once, then match in memory. */
export async function matchLeadsAgainstCustomers(
  leads: LeadInput[],
): Promise<Map<number, MatchResult>> {
  const out = new Map<number, MatchResult>();
  if (!leads.length) return out;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return out;
  const { data, error } = await supabase
    .from("customer_database")
    .select("id, full_name, phone, phone_norm, email, city, governorate, address, fb_id, fb_profile_url, name_norm, notes")
    .eq("user_id", user.id)
    .limit(50000);
  if (error || !data?.length) return out;

  const byFbId = new Map<string, CustomerRow>();
  const byPhone = new Map<string, CustomerRow>();
  const byEmail = new Map<string, CustomerRow>();
  const byName = new Map<string, CustomerRow>();
  for (const r of data as Array<CustomerRow & { name_norm?: string | null; phone_norm?: string | null }>) {
    if (r.fb_id) byFbId.set(r.fb_id, r);
    if (r.phone_norm) byPhone.set(r.phone_norm, r);
    if (r.email) byEmail.set(r.email.toLowerCase(), r);
    if (r.name_norm) byName.set(r.name_norm, r);
  }

  leads.forEach((lead, idx) => {
    const fbId = lead.fb_id || extractFbId(lead.fb_profile_url);
    if (fbId && byFbId.has(fbId)) { out.set(idx, { ...byFbId.get(fbId)!, matched_by: "fb_id" }); return; }
    const ph = normalizePhone(lead.phone);
    if (ph && byPhone.has(ph)) { out.set(idx, { ...byPhone.get(ph)!, matched_by: "phone" }); return; }
    if (lead.email) {
      const em = lead.email.toLowerCase();
      if (byEmail.has(em)) { out.set(idx, { ...byEmail.get(em)!, matched_by: "email" }); return; }
    }
    if (lead.name) {
      const n = normalizeArabic(lead.name);
      if (n && n.length >= 4 && byName.has(n)) { out.set(idx, { ...byName.get(n)!, matched_by: "name" }); return; }
    }
  });

  return out;
}
