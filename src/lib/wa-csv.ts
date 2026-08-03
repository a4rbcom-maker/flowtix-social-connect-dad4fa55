import type { WaContact } from "@/types/wa-contacts.types";

const HEADERS = ["name", "phone", "email", "country", "company", "tags", "is_vip"];

export function contactsToCSV(contacts: WaContact[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : Array.isArray(v) ? v.join("|") : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = contacts.map((c) => HEADERS.map((h) => esc((c as any)[h])).join(","));
  return [HEADERS.join(","), ...rows].join("\n");
}

export function downloadCSV(filename: string, csv: string): void {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function parseCSV(text: string): Partial<WaContact>[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const out: Partial<WaContact>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: any = {};
    headers.forEach((h, idx) => {
      if (h === "tags") row.tags = values[idx] ? values[idx].split("|") : [];
      else if (h === "is_vip") row.is_vip = values[idx] === "true";
      else row[h] = values[idx] || undefined;
    });
    if (row.phone) out.push(row);
  }
  return out;
}

export function downloadImportTemplate(): void {
  const tpl = "name,phone,email,country,company,tags,is_vip\nاحمد,+201234567890,eg,شركتي,vip|عميل,true";
  downloadCSV("wa-import-template.csv", tpl);
}
