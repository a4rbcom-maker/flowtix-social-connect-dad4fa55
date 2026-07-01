import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Database, Upload, Search, Trash2, Loader2, FileSpreadsheet, Users, UserPlus, ClipboardPaste, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { autoMapHeaders, buildRow, type CustomerRow } from "@/lib/customer-db";

export const Route = createFileRoute("/dashboard/customers")({
  ssr: false,
  component: CustomersPage,
});

type MappableField = "full_name" | "phone" | "email" | "city" | "governorate" | "address" | "fb_id" | "fb_profile_url" | "notes";

const FIELD_LABELS_AR: Record<MappableField, string> = {
  full_name: "الاسم", phone: "الموبايل", email: "الإيميل", city: "المدينة",
  governorate: "المحافظة", address: "العنوان", fb_id: "Facebook ID",
  fb_profile_url: "رابط البروفايل", notes: "ملاحظات",
};
const FIELD_LABELS_EN: Record<MappableField, string> = {
  full_name: "Name", phone: "Mobile", email: "Email", city: "City",
  governorate: "Governorate", address: "Address", fb_id: "Facebook ID",
  fb_profile_url: "Profile URL", notes: "Notes",
};

function CustomersPage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const labels = isAr ? FIELD_LABELS_AR : FIELD_LABELS_EN;
  const fileRef = useRef<HTMLInputElement>(null);

  const [count, setCount] = useState<number>(0);
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  // Upload-wizard state
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<MappableField, string>>>({});
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Manual-add state
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTab, setManualTab] = useState<"single" | "paste">("single");
  const [mName, setMName] = useState("");
  const [mPhone, setMPhone] = useState("");
  const [mEmail, setMEmail] = useState("");
  const [mCity, setMCity] = useState("");
  const [mNotes, setMNotes] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  const loadRows = useCallback(async () => {
    setBusy(true);
    try {

      const { count: c } = await supabase
        .from("customer_database")
        .select("id", { count: "exact", head: true });
      setCount(c ?? 0);

      let q = supabase
        .from("customer_database")
        .select("id, full_name, phone, email, city, governorate, address, fb_id, fb_profile_url, notes")
        .order("created_at", { ascending: false })
        .limit(200);
      if (search.trim()) {
        const s = `%${search.trim()}%`;
        q = q.or(`full_name.ilike.${s},phone.ilike.${s},email.ilike.${s},city.ilike.${s},fb_id.ilike.${s}`);
      }
      const { data } = await q;
      setRows((data as CustomerRow[]) ?? []);
    } finally { setBusy(false); }
  }, [search]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      if (!json.length) { toast.error(isAr ? "الملف فاضي" : "Empty file"); return; }
      const hdrs = Object.keys(json[0]);
      setHeaders(hdrs);
      setPreview(json.slice(0, 5));
      setMapping(autoMapHeaders(hdrs) as Partial<Record<MappableField, string>>);
      // Stash full json on the element for import
      (fileRef.current as unknown as { _rows?: Record<string, unknown>[] })._rows = json;
      toast.success(isAr ? `تم تحميل ${json.length} صف — راجع التطابق ثم اضغط استيراد` : `Loaded ${json.length} rows`);
    } catch (err) {
      toast.error(String(err));
    }
  };

  const doImport = async () => {
    const all = (fileRef.current as unknown as { _rows?: Record<string, unknown>[] })?._rows ?? [];
    if (!all.length || !mapping.full_name && !mapping.phone && !mapping.fb_id && !mapping.email) {
      toast.error(isAr ? "اربط على الأقل عمود الاسم أو الموبايل" : "Map at least name/phone");
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Auth required"); return; }
    setUploading(true);
    setProgress(0);
    try {
      const prepared = all.map((r) => buildRow({
        user_id: user.id,
        full_name: mapping.full_name ? String(r[mapping.full_name] ?? "") : null,
        phone: mapping.phone ? String(r[mapping.phone] ?? "") : null,
        email: mapping.email ? String(r[mapping.email] ?? "") : null,
        city: mapping.city ? String(r[mapping.city] ?? "") : null,
        governorate: mapping.governorate ? String(r[mapping.governorate] ?? "") : null,
        address: mapping.address ? String(r[mapping.address] ?? "") : null,
        fb_id: mapping.fb_id ? String(r[mapping.fb_id] ?? "") : null,
        fb_profile_url: mapping.fb_profile_url ? String(r[mapping.fb_profile_url] ?? "") : null,
        notes: mapping.notes ? String(r[mapping.notes] ?? "") : null,
      })).filter((r) => r.full_name || r.phone || r.fb_id || r.email);

      const CHUNK = 500;
      let done = 0;
      for (let i = 0; i < prepared.length; i += CHUNK) {
        const slice = prepared.slice(i, i + CHUNK);
        const { error } = await supabase.from("customer_database").insert(slice);
        if (error) throw error;
        done += slice.length;
        setProgress(Math.round((done / prepared.length) * 100));
      }
      toast.success(isAr ? `تم استيراد ${done} عميل` : `Imported ${done} customers`);
      setHeaders([]); setPreview([]); setMapping({});
      if (fileRef.current) fileRef.current.value = "";
      loadRows();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setUploading(false);
    }
  };

  const deleteOne = async (id: string) => {
    if (!confirm(isAr ? "حذف هذا العميل؟" : "Delete this customer?")) return;
    const { error } = await supabase.from("customer_database").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(isAr ? "تم الحذف" : "Deleted");
    loadRows();
  };

  const wipeAll = async () => {
    if (!confirm(isAr ? `حذف كل العملاء (${count})؟ لا يمكن التراجع.` : `Delete ALL ${count} customers?`)) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("customer_database").delete().eq("user_id", user.id);
    if (error) return toast.error(error.message);
    toast.success(isAr ? "تم المسح" : "Wiped");
    loadRows();
  };

  const saveSingle = async () => {
    if (!mName.trim() && !mPhone.trim() && !mEmail.trim()) {
      toast.error(isAr ? "أدخل الاسم أو الموبايل على الأقل" : "Enter name or phone");
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Auth required"); return; }
    setSavingManual(true);
    try {
      const row = buildRow({
        user_id: user.id,
        full_name: mName || null,
        phone: mPhone || null,
        email: mEmail || null,
        city: mCity || null,
        notes: mNotes || null,
      });
      const { error } = await supabase.from("customer_database").insert([row]);
      if (error) throw error;
      toast.success(isAr ? "تم حفظ العميل" : "Customer saved");
      setMName(""); setMPhone(""); setMEmail(""); setMCity(""); setMNotes("");
      setManualOpen(false);
      loadRows();
    } catch (err) { toast.error(String((err as Error).message ?? err)); }
    finally { setSavingManual(false); }
  };

  const savePaste = async () => {
    const text = pasteText.trim();
    if (!text) { toast.error(isAr ? "الصق أرقاماً أولاً" : "Paste something first"); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Auth required"); return; }
    // Each line: "phone" OR "phone,name" OR "name,phone" OR just "name" — auto-detects digits
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const prepared = lines.map((line) => {
      const parts = line.split(/[,;\t|]+/).map((p) => p.trim()).filter(Boolean);
      let phone: string | null = null;
      let name: string | null = null;
      for (const p of parts) {
        const digits = p.replace(/[^\d+]/g, "");
        if (!phone && digits.length >= 7) phone = digits;
        else if (!name) name = p;
      }
      if (parts.length === 1 && !phone) name = parts[0];
      return buildRow({ user_id: user.id, full_name: name, phone });
    }).filter((r) => r.full_name || r.phone);
    if (!prepared.length) { toast.error(isAr ? "لم يتم اكتشاف بيانات صحيحة" : "No valid rows"); return; }
    setSavingManual(true);
    try {
      const CHUNK = 500;
      let done = 0;
      for (let i = 0; i < prepared.length; i += CHUNK) {
        const slice = prepared.slice(i, i + CHUNK);
        const { error } = await supabase.from("customer_database").insert(slice);
        if (error) throw error;
        done += slice.length;
      }
      toast.success(isAr ? `تم حفظ ${done} عميل` : `Saved ${done} customers`);
      setPasteText("");
      setManualOpen(false);
      loadRows();
    } catch (err) { toast.error(String((err as Error).message ?? err)); }
    finally { setSavingManual(false); }
  };



  return (
    <DashboardLayout title={isAr ? "قاعدة عملائي" : "My customers"}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold">
              <Database className="h-6 w-6 text-primary" />
              {isAr ? "قاعدة عملائي الشخصية" : "My personal customer database"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {isAr
                ? "ارفع ملف Excel فيه بيانات عملائك (اسم، موبايل، إيميل، مدينة، رابط فيسبوك). أي عميل تستخرجه من فيسبوك بعد كده هيتطابق تلقائياً ويظهرلك بياناته كاملة."
                : "Upload an Excel with your customers (name, mobile, email, city, FB link). Every lead extracted from Facebook will be auto-matched and enriched with the data you already have."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5 border-primary/30 px-3 py-1.5 text-primary">
              <Users className="h-3.5 w-3.5" /> {count.toLocaleString()} {isAr ? "عميل" : "customers"}
            </Badge>
            <Dialog open={manualOpen} onOpenChange={setManualOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <UserPlus className="h-4 w-4" />
                  {isAr ? "إضافة عميل" : "Add customer"}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{isAr ? "إضافة عملاء يدوياً" : "Add customers manually"}</DialogTitle>
                </DialogHeader>
                <Tabs value={manualTab} onValueChange={(v) => setManualTab(v as "single" | "paste")}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="single" className="gap-2"><UserPlus className="h-4 w-4" />{isAr ? "عميل واحد" : "Single"}</TabsTrigger>
                    <TabsTrigger value="paste" className="gap-2"><ClipboardPaste className="h-4 w-4" />{isAr ? "لصق مجمّع" : "Bulk paste"}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="single" className="space-y-3 pt-4">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">{labels.full_name}</label>
                      <Input value={mName} onChange={(e) => setMName(e.target.value)} placeholder={isAr ? "الاسم الكامل" : "Full name"} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">{labels.phone}</label>
                        <Input value={mPhone} onChange={(e) => setMPhone(e.target.value)} placeholder="01xxxxxxxxx" inputMode="tel" dir="ltr" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">{labels.city}</label>
                        <Input value={mCity} onChange={(e) => setMCity(e.target.value)} placeholder={isAr ? "المدينة" : "City"} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">{labels.email}</label>
                      <Input value={mEmail} onChange={(e) => setMEmail(e.target.value)} placeholder="email@example.com" dir="ltr" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">{labels.notes}</label>
                      <Textarea value={mNotes} onChange={(e) => setMNotes(e.target.value)} rows={2} placeholder={isAr ? "ملاحظات اختيارية" : "Optional notes"} />
                    </div>
                  </TabsContent>
                  <TabsContent value="paste" className="space-y-3 pt-4">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {isAr
                        ? "الصق قائمة أرقام — كل سطر رقم واحد. يمكنك أيضاً كتابة الرقم متبوعاً بفاصلة ثم الاسم مثل: 01012345678,أحمد"
                        : "Paste one number per line. You can also add a name after a comma: 01012345678,Ahmed"}
                    </p>
                    <Textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      rows={10}
                      dir="ltr"
                      className="font-mono text-sm"
                      placeholder={`01012345678\n01198765432,محمد\n01234567890,سارة`}
                    />
                    <p className="text-xs text-muted-foreground">
                      {isAr ? `${pasteText.split(/\r?\n/).filter((l) => l.trim()).length} سطر` : `${pasteText.split(/\r?\n/).filter((l) => l.trim()).length} lines`}
                    </p>
                  </TabsContent>
                </Tabs>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setManualOpen(false)} disabled={savingManual}>
                    {isAr ? "إلغاء" : "Cancel"}
                  </Button>
                  <Button onClick={manualTab === "single" ? saveSingle : savePaste} disabled={savingManual} className="gap-2">
                    {savingManual && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isAr ? "حفظ" : "Save"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {count > 0 && (
              <Button variant="ghost" size="sm" onClick={wipeAll} className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>

        </div>

        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent">
              <Upload className="h-4 w-4" />
              {isAr ? "رفع ملف Excel" : "Upload Excel"}
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
            </label>
            <span className="text-xs text-muted-foreground">
              {isAr ? "يدعم xlsx / xls / csv — يكتشف الأعمدة تلقائياً" : "Supports xlsx/xls/csv with auto column detection"}
            </span>
          </div>

          {headers.length > 0 && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                {isAr ? "ربط أعمدة الملف بحقول قاعدة العملاء" : "Map file columns to customer fields"}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(Object.keys(labels) as MappableField[]).map((field) => (
                  <div key={field} className="space-y-1">
                    <label className="text-xs text-muted-foreground">{labels[field]}</label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      value={mapping[field] ?? ""}
                      onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value || undefined }))}
                    >
                      <option value="">— {isAr ? "تجاهل" : "ignore"} —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {preview.length > 0 && (
                <div className="overflow-auto rounded-md border border-border bg-background">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>{headers.map((h) => <th key={h} className="px-2 py-1.5 text-start">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {preview.map((r, i) => (
                        <tr key={i}>{headers.map((h) => <td key={h} className="max-w-[180px] truncate px-2 py-1">{String(r[h] ?? "")}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Button onClick={doImport} disabled={uploading} className="gap-2">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {isAr ? "استيراد إلى قاعدة العملاء" : "Import into database"}
                </Button>
                {uploading && <span className="text-sm text-muted-foreground">{progress}%</span>}
              </div>
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isAr ? "ابحث بالاسم أو الموبايل أو الإيميل أو الـ FB ID..." : "Search name, mobile, email, FB ID..."}
                className="ps-9"
              />
            </div>
            {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {count === 0
                ? (isAr ? "ابدأ برفع ملف Excel فيه عملائك" : "Start by uploading an Excel of your customers")
                : (isAr ? "لا نتائج" : "No matches")}
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{labels.full_name}</th>
                    <th className="px-3 py-2 text-start">{labels.phone}</th>
                    <th className="px-3 py-2 text-start">{labels.email}</th>
                    <th className="px-3 py-2 text-start">{labels.city}</th>
                    <th className="px-3 py-2 text-start">{labels.fb_id}</th>
                    <th className="px-3 py-2 text-start"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-medium">{r.full_name ?? "—"}</td>
                      <td className="px-3 py-2 font-mono">{r.phone ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.email ?? "—"}</td>
                      <td className="px-3 py-2">{r.city ?? r.governorate ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.fb_id ?? "—"}</td>
                      <td className="px-3 py-2 text-end">
                        <Button size="icon" variant="ghost" onClick={() => deleteOne(r.id!)}>
                          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {count > rows.length && (
                <div className="border-t border-border/60 bg-muted/20 px-4 py-2 text-center text-xs text-muted-foreground">
                  {isAr ? `يعرض أول ${rows.length} من ${count} — استخدم البحث للوصول لبقية العملاء` : `Showing ${rows.length} of ${count} — use search`}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}
