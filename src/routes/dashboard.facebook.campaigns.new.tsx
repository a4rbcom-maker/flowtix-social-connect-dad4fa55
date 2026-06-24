import { createFileRoute, useNavigate, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Save, Loader2, ChevronDown, FileText, Image as ImageIcon, Type, Layers, ArrowLeft,
  Users, Search, AlertCircle, Check, AlertTriangle, ClipboardPaste, X, Hash, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { listBotAccounts } from "@/lib/fb-bot.functions";
import { fetchFacebookGroups } from "@/lib/facebook.functions";
import {
  listTextTemplates, listMediaAssets, saveCampaign, startCampaign, recordMediaAsset,
} from "@/lib/fb-campaigns.functions";
import { safeArray, safeObject } from "@/lib/safe-data";
import type { Tables } from "@/integrations/supabase/types";

function NewCampaignErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <DashboardLayout title="حملة جديدة">
      <div className="max-w-xl mx-auto mt-12 rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-destructive" />
        <h2 className="text-lg font-semibold text-foreground mb-2">حدث خطأ في صفحة إنشاء الحملة</h2>
        <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive whitespace-pre-wrap break-words">
          {error?.message ?? "Unknown error"}
        </pre>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          إعادة المحاولة
        </button>
      </div>
    </DashboardLayout>
  );
}

export const Route = createFileRoute("/dashboard/facebook/campaigns/new")({
  ssr: false,
  component: NewCampaignPage,
  errorComponent: NewCampaignErrorComponent,
});

type BotAccount = { id: string; display_name: string };
type Template = Tables<"fb_text_templates">;
type Media = Tables<"fb_media_assets">;
type Group = { id: string; name: string };

function NewCampaignPage() {
  const { user, loading } = useAuth();
  const { lang, dir } = useI18n();
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState<BotAccount[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Form
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [contentType, setContentType] = useState<"text" | "media">("text");
  const [templateId, setTemplateId] = useState("");
  const [customText, setCustomText] = useState("");
  const [mediaIds, setMediaIds] = useState<Set<string>>(new Set());
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [delayMin, setDelayMin] = useState(60);
  const [delayMax, setDelayMax] = useState(120);

  const [saving, setSaving] = useState(false);
  const [savingAndStart, setSavingAndStart] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Manual Group IDs entry (bot mode)
  const [manualOpen, setManualOpen] = useState(false);
  const [manualRaw, setManualRaw] = useState("");

  const t = lang === "ar" ? {
    back: "العودة للحملات",
    title: "حملة جديدة", subtitle: "نشر منشور واحد على عدة وجهات بفاصل زمني آمن",
    name: "اسم الحملة", namePh: "مثلاً: حملة سبتمبر للمنتج X",
    account: "اختيار قناة", accountPh: "اختر حساب فيسبوك",
    targets: "اختيار الوجهات", targetsHint: "حدد الجروبات التي ستُنشَر فيها الحملة",
    loadGroups: "جلب الجروبات", searchPh: "ابحث عن جروب...",
    selectAll: "تحديد الكل", clearAll: "إلغاء التحديد", selected: "محدد",
    noGroups: "اضغط \"جلب الجروبات\" لاستيراد جروباتك",
    sendType: "نوع الإرسال", text: "نص", mediaType: "وسائط",
    template: "اختر قالباً (اختياري)", noTemplate: "بدون قالب — اكتب نصاً مباشرة",
    customText: "أو اكتب نصاً مخصصاً", customPh: "اكتب نص المنشور هنا...",
    chooseMedia: "اختر الوسائط", noMedia: "لا توجد وسائط — ارفعها أولاً من مكتبة الوسائط",
    delay: "الفاصل الزمني لكل عملية إضافة (بالثواني)",
    delayHint: "يجب عليك إضافة الفترات الزمنية بعناية حتى لا يتم حظر حسابك.",
    min: "الحد الأدنى", max: "الحد الأقصى",
    save: "حفظ التغييرات", saveAndStart: "حفظ وبدء الآن",
    saved: "تم الحفظ", started: "بدأت الحملة",
    needName: "أدخل اسم الحملة",
    needAccount: "اختر حساب فيسبوك",
    needContent: "أضف نصاً أو وسائط للمنشور",
    needTargets: "حدد وجهة واحدة على الأقل",
    delayErr: "الحد الأقصى يجب أن يكون ≥ الحد الأدنى",
    manualToggle: "إدخال Group IDs يدويًا",
    manualHint: "الصق معرفات الجروبات (رقم لكل سطر، أو افصلها بفاصلة/مسافة). أرقام فقط، 5–25 خانة.",
    manualPh: "مثلاً:\n123456789012345\n987654321098765, 555555555555",
    manualAdd: "تحقّق وإضافة",
    manualClear: "مسح",
    manualPaste: "لصق من الحافظة",
    manualNoneValid: "لا توجد معرفات صالحة",
    manualAdded: (n: number, dup: number, invalid: number) =>
      `أُضيفت ${n} جروب${dup ? ` • ${dup} مكرر` : ""}${invalid ? ` • ${invalid} غير صالح` : ""}`,
    manualBadge: "يدوي",
    remove: "إزالة",
  } : {
    back: "Back to campaigns",
    title: "New campaign", subtitle: "Post one message to many destinations with a safe interval",
    name: "Campaign name", namePh: "e.g.: September campaign for Product X",
    account: "Choose channel", accountPh: "Select Facebook account",
    targets: "Choose destinations", targetsHint: "Pick the groups to post the campaign in",
    loadGroups: "Load groups", searchPh: "Search group...",
    selectAll: "Select all", clearAll: "Clear", selected: "selected",
    noGroups: "Click \"Load groups\" to import your groups",
    sendType: "Send type", text: "Text", mediaType: "Media",
    template: "Pick a template (optional)", noTemplate: "No template — write text directly",
    customText: "Or write custom text", customPh: "Type your post here...",
    chooseMedia: "Pick media", noMedia: "No media — upload from Media Library first",
    delay: "Interval per add operation (seconds)",
    delayHint: "Add intervals carefully to avoid getting your account blocked.",
    min: "Min", max: "Max",
    save: "Save changes", saveAndStart: "Save & start now",
    saved: "Saved", started: "Campaign started",
    needName: "Enter campaign name",
    needAccount: "Select an account",
    needContent: "Add text or media to the post",
    needTargets: "Select at least one destination",
    delayErr: "Max must be >= Min",
    manualToggle: "Enter Group IDs manually",
    manualHint: "Paste Group IDs (one per line, or separated by comma/space). Digits only, 5–25 chars.",
    manualPh: "e.g.:\n123456789012345\n987654321098765, 555555555555",
    manualAdd: "Validate & add",
    manualClear: "Clear",
    manualPaste: "Paste from clipboard",
    manualNoneValid: "No valid IDs found",
    manualAdded: (n: number, dup: number, invalid: number) =>
      `Added ${n} group${dup ? ` • ${dup} duplicate` : ""}${invalid ? ` • ${invalid} invalid` : ""}`,
    manualBadge: "manual",
    remove: "Remove",
  };

  useEffect(() => { if (!loading && !user) navigate({ to: "/login" }); }, [user, loading, navigate]);

  const callFn = async <T,>(fn: (opts: never) => Promise<T>, body?: unknown): Promise<T> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return fn({ data: body, headers: { Authorization: `Bearer ${session.access_token}` } } as never);
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [a, tpl, med] = await Promise.all([
          callFn<{ accounts: BotAccount[] }>(listBotAccounts),
          callFn<Template[]>(listTextTemplates),
          callFn<Media[]>(listMediaAssets),
        ]);
        const accs = safeArray<BotAccount>(safeObject<{ accounts?: unknown }>(a)?.accounts);
        setAccounts(accs);
        setTemplates(safeArray<Template>(tpl));
        setMedia(safeArray<Media>(med));
        if (accs.length === 1) setAccountId(accs[0].id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    // eslint-disable-next-line
  }, [user]);

  const loadGroups = async () => {
    setGroupsLoading(true);
    try {
      const res = await callFn<{ groups?: unknown; error: unknown }>(fetchFacebookGroups);
      if (res.error) throw new Error("Connect your Facebook account first");
      const list = safeArray<Group>(res.groups);
      setGroups(list);
      toast.success(`${list.length} ${lang === "ar" ? "جروب" : "groups"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setGroupsLoading(false);
    }
  };

  const parseManualIds = (raw: string): { valid: string[]; invalid: number } => {
    const tokens = raw.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    const valid: string[] = [];
    let invalid = 0;
    const seen = new Set<string>();
    for (const tok of tokens) {
      // Accept full URLs too: extract trailing digit run
      const m = tok.match(/(\d{5,25})/);
      const id = m?.[1];
      if (id && !seen.has(id)) { seen.add(id); valid.push(id); }
      else if (!id) invalid++;
    }
    return { valid, invalid };
  };

  const handleAddManual = () => {
    const { valid, invalid } = parseManualIds(manualRaw);
    if (valid.length === 0) { toast.error(t.manualNoneValid); return; }
    const existing = new Set(groups.map((g) => g.id));
    let added = 0, dup = 0;
    const newGroups = [...groups];
    const nextSelected = new Set(selectedTargets);
    for (const id of valid) {
      if (existing.has(id)) { dup++; }
      else { newGroups.push({ id, name: `Group ${id}` }); added++; }
      nextSelected.add(id);
    }
    setGroups(newGroups);
    setSelectedTargets(nextSelected);
    setManualRaw("");
    toast.success(t.manualAdded(added, dup, invalid));
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setManualRaw((prev) => (prev ? prev + "\n" + text : text));
    } catch {
      toast.error(lang === "ar" ? "تعذّر الوصول للحافظة" : "Clipboard unavailable");
    }
  };

  const manualPreview = useMemo(() => parseManualIds(manualRaw), [manualRaw]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q) || g.id.includes(q));
  }, [groups, search]);


  const validate = (): boolean => {
    if (!name.trim()) { toast.error(t.needName); return false; }
    if (!accountId) { toast.error(t.needAccount); return false; }
    if (selectedTargets.size === 0) { toast.error(t.needTargets); return false; }
    if (delayMax < delayMin) { toast.error(t.delayErr); return false; }
    if (contentType === "text" && !templateId && !customText.trim()) { toast.error(t.needContent); return false; }
    if (contentType === "media" && mediaIds.size === 0 && !customText.trim()) { toast.error(t.needContent); return false; }
    return true;
  };

  const buildPayload = () => {
    const targets = Array.from(selectedTargets).map((id) => {
      const g = groups.find((x) => x.id === id);
      return { id, name: g?.name ?? id };
    });
    return {
      name: name.trim(),
      accountId,
      contentType,
      templateId: templateId || null,
      customText: customText.trim() || null,
      mediaIds: Array.from(mediaIds),
      targetKind: "groups" as const,
      targets,
      delayMinSeconds: delayMin,
      delayMaxSeconds: delayMax,
    };
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error(lang === "ar" ? "حجم الملف أكبر من 50MB" : "File exceeds 50MB");
      return;
    }
    const kind: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";
    setUploading(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("fb-media").upload(path, file, {
        contentType: file.type, upsert: false,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("fb-media").getPublicUrl(path);
      const row = await callFn<Media>(recordMediaAsset, {
        kind, storagePath: path, publicUrl: pub.publicUrl,
        name: file.name, sizeBytes: file.size, mimeType: file.type,
      });
      setMedia((prev) => [row, ...prev]);
      setMediaIds((prev) => { const n = new Set(prev); n.add(row.id); return n; });
      setContentType("media");
      toast.success(lang === "ar" ? "تم الرفع" : "Uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleSave = async (startNow: boolean) => {
    if (!validate()) return;
    startNow ? setSavingAndStart(true) : setSaving(true);
    try {
      const c = await callFn<{ id: string }>(saveCampaign, buildPayload());
      toast.success(t.saved);
      if (startNow) {
        await callFn(startCampaign, { id: c.id });
        toast.success(t.started);
      }
      navigate({ to: "/dashboard/facebook/campaigns" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false); setSavingAndStart(false);
    }
  };

  if (loading) return null;

  return (
    <DashboardLayout title={t.title}>
      <div dir={dir} className="space-y-6 max-w-3xl mx-auto">
        <div>
          <Link to="/dashboard/facebook/campaigns" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="w-4 h-4" /> {t.back}
          </Link>
          <h2 className="text-2xl font-bold text-foreground">{t.title}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t.subtitle}</p>
        </div>

        {/* Name */}
        <Section icon={<Type className="w-4 h-4" />} label={t.name}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.namePh}
            maxLength={120}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </Section>

        {/* Account */}
        <Section icon={<Layers className="w-4 h-4" />} label={t.account}>
          <div className="relative">
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">{t.accountPh}</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
            </select>
            <ChevronDown className={`w-4 h-4 absolute top-3 ${dir === "rtl" ? "left-3" : "right-3"} text-muted-foreground pointer-events-none`} />
          </div>
        </Section>

        {/* Targets */}
        <Section icon={<Users className="w-4 h-4" />} label={t.targets} hint={t.targetsHint}>
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-3">
              <p className="text-sm text-muted-foreground">{t.noGroups}</p>
              <button onClick={loadGroups} disabled={groupsLoading} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {groupsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                {t.loadGroups}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className={`w-4 h-4 absolute top-2.5 ${dir === "rtl" ? "right-3" : "left-3"} text-muted-foreground`} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t.searchPh}
                    className={`w-full rounded-lg border border-border bg-background py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${dir === "rtl" ? "pr-9 pl-3" : "pl-9 pr-3"}`}
                  />
                </div>
                <button onClick={() => setSelectedTargets(new Set(filteredGroups.map((g) => g.id)))} className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent">{t.selectAll}</button>
                <button onClick={() => setSelectedTargets(new Set())} className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent">{t.clearAll}</button>
              </div>
              <div className="text-xs text-muted-foreground"><b className="text-foreground">{selectedTargets.size}</b> {t.selected} / {filteredGroups.length}</div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {filteredGroups.map((g) => {
                  const sel = selectedTargets.has(g.id);
                  return (
                    <button
                      type="button"
                      key={g.id}
                      onClick={() => setSelectedTargets((prev) => { const n = new Set(prev); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent transition-colors ${sel ? "bg-primary/5" : ""}`}
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center ${sel ? "bg-primary border-primary" : "border-border"}`}>
                        {sel && <Check className="w-3 h-3 text-primary-foreground" />}
                      </span>
                      <span className="flex-1 text-start truncate flex items-center gap-2">
                        <span className="truncate">{g.name}</span>
                        {g.name === `Group ${g.id}` && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary shrink-0">
                            {t.manualBadge}
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">{g.id}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Manual Group IDs entry (always available when an account is selected) */}
          {accountId && (
            <div className="mt-3 rounded-xl border border-dashed border-border bg-background/40">
              <button
                type="button"
                onClick={() => setManualOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-accent/40 rounded-xl transition"
              >
                <span className="inline-flex items-center gap-2">
                  <Hash className="w-4 h-4 text-primary" />
                  {t.manualToggle}
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${manualOpen ? "rotate-180" : ""}`} />
              </button>
              {manualOpen && (
                <div className="px-4 pb-4 pt-1 space-y-2">
                  <p className="text-xs text-muted-foreground">{t.manualHint}</p>
                  <textarea
                    value={manualRaw}
                    onChange={(e) => setManualRaw(e.target.value)}
                    placeholder={t.manualPh}
                    rows={4}
                    maxLength={50000}
                    spellCheck={false}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-xs text-muted-foreground">
                      {manualRaw.trim() && (
                        <>
                          <b className="text-foreground">{manualPreview.valid.length}</b> {lang === "ar" ? "صالح" : "valid"}
                          {manualPreview.invalid > 0 && <> • <b className="text-destructive">{manualPreview.invalid}</b> {lang === "ar" ? "غير صالح" : "invalid"}</>}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handlePasteClipboard}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs hover:bg-accent"
                      >
                        <ClipboardPaste className="w-3.5 h-3.5" /> {t.manualPaste}
                      </button>
                      {manualRaw && (
                        <button
                          type="button"
                          onClick={() => setManualRaw("")}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs hover:bg-accent"
                        >
                          <X className="w-3.5 h-3.5" /> {t.manualClear}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleAddManual}
                        disabled={manualPreview.valid.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
                      >
                        <Check className="w-3.5 h-3.5" /> {t.manualAdd}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </Section>


        {/* Post content — text + media together */}
        <Section icon={<FileText className="w-4 h-4" />} label={t.sendType}>
          {/* Template selector — always available */}
          <div className="space-y-2">
            <div className="relative">
              <select
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  const tpl = templates.find((x) => x.id === e.target.value);
                  if (tpl) setCustomText("");
                }}
                className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">{t.noTemplate}</option>
                {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
              </select>
              <ChevronDown className={`w-4 h-4 absolute top-3 ${dir === "rtl" ? "left-3" : "right-3"} text-muted-foreground pointer-events-none`} />
            </div>
            {!templateId && (
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder={t.customPh}
                rows={4}
                maxLength={20000}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            )}
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-medium text-foreground">
                {t.chooseMedia} <span className="text-muted-foreground font-normal">({lang === "ar" ? "اختياري" : "optional"})</span>
              </p>
              <label className={`inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 cursor-pointer ${uploading ? "opacity-60 cursor-not-allowed" : ""}`}>
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {lang === "ar" ? "رفع صورة / فيديو" : "Upload image / video"}
                <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleUpload} disabled={uploading} />
              </label>
            </div>
            {media.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                {lang === "ar" ? "لا توجد وسائط بعد — ارفع ملفًا الآن أو من " : "No media yet — upload now or from "}
                <Link to="/dashboard/facebook/media" className="text-primary hover:underline">{lang === "ar" ? "المكتبة" : "library"}</Link>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {media.map((m) => {
                  const sel = mediaIds.has(m.id);
                  return (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => setMediaIds((prev) => { const n = new Set(prev); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })}
                      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${sel ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
                    >
                      {m.kind === "image" ? (
                        <img src={m.public_url} alt={m.name} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full bg-muted flex items-center justify-center"><ImageIcon className="w-6 h-6 text-muted-foreground" /></div>
                      )}
                      {sel && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center"><Check className="w-3 h-3" /></span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </Section>


        {/* Delay */}
        <Section icon={<AlertCircle className="w-4 h-4" />} label={t.delay}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.min}</label>
              <input
                type="number"
                min={10}
                max={3600}
                value={delayMin}
                onChange={(e) => setDelayMin(Math.max(10, Number(e.target.value) || 10))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.max}</label>
              <input
                type="number"
                min={10}
                max={3600}
                value={delayMax}
                onChange={(e) => setDelayMax(Math.max(10, Number(e.target.value) || 10))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t.delayHint}</span>
          </div>
        </Section>

        {/* Actions */}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => handleSave(false)}
            disabled={saving || savingAndStart}
            className="flex-1 rounded-xl bg-foreground text-background px-4 py-3 text-sm font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t.save}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving || savingAndStart}
            className="flex-1 rounded-xl bg-primary text-primary-foreground px-4 py-3 text-sm font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {savingAndStart ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t.saveAndStart}
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Section({ icon, label, hint, children }: { icon: React.ReactNode; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</span>
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
      </div>
      {hint && <p className="text-xs text-muted-foreground mb-3 -mt-1">{hint}</p>}
      {children}
    </div>
  );
}
