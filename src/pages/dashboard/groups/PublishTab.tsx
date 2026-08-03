import { useState, useRef } from "react";
import { Send, Hash, Settings2, X, Paperclip } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { useActiveSessionsForSelect } from "@/hooks/useFbSessions";
import { ProgressDashboard } from "./ProgressDashboard";

interface Props { preselected?: {id: string; name: string}[]; }

export function PublishTab({ preselected = [] }: Props) {
  const activeSelect = useActiveSessionsForSelect();
  const sessionId = activeSelect.data?.[0]?.value;

  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(preselected.map(g => g.id)));
  const [delayMin, setDelayMin] = useState(60);
  const [delayMax, setDelayMax] = useState(180);
  const [skipRestricted, setSkipRestricted] = useState(true);
  const [phase, setPhase] = useState<"config" | "running">("config");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const imageRef = useRef<HTMLInputElement>(null);

  if (phase === "running" && activeJobId) {
    return <ProgressDashboard jobId={activeJobId} onDone={() => { setPhase("config"); setActiveJobId(null); }} />;
  }

  const toggleGroup = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === preselected.length) setSelected(new Set());
    else setSelected(new Set(preselected.map(g => g.id)));
  };

  const selectedIds = Array.from(selected);

  const handleStart = async () => {
    if (!sessionId || !message.trim() || selectedIds.length === 0) return;
    setError("");
    setPhase("running");
    try {
      const res = await fetch(`${import.meta.env.VITE_EXTRACTION_API_URL}/publish/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": import.meta.env.VITE_EXTRACTION_API_KEY || "" },
        body: JSON.stringify({ session_id: sessionId, message: message.trim(), group_ids: selectedIds, delay_min: delayMin, delay_max: delayMax, max_retries: 3, skip_restricted: skipRestricted, batch_size: 5, batch_pause: 50 }),
      });
      const data = await res.json();
      if (data.job_id) setActiveJobId(data.job_id);
      else { setPhase("config"); setError(data.error?.message || "فشل بدء النشر"); }
    } catch (err) { setPhase("config"); setError(String(err)); }
  };

  const charCount = message.length;
  const charLimit = 5000;

  return (
    <div className="grid gap-6 xl:grid-cols-5 mt-2">
      {/* LEFT: Message Editor + Media */}
      <Card className="xl:col-span-3 overflow-hidden border-2 border-[var(--color-border)]">
        <CardHeader className="pb-2 px-6 pt-6">
          <CardTitle className="flex items-center gap-3 text-lg">
            <div className="p-2 rounded-lg bg-[var(--color-primary)]/10"><Send className="size-5 text-[var(--color-primary)]" /></div>
            كتابة الرسالة
          </CardTitle>
          <CardDescription className="pt-1">اكتب رسالتك التي سيتم نشرها في الجروبات المحددة. يمكنك إرفاق صور وفيديو.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-6 pb-6">
          <div className="relative">
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="اكتب رسالتك هنا..."
              className="w-full rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-5 py-4 text-sm resize-none min-h-[220px] focus:outline-none focus:border-[var(--color-primary)] transition-colors placeholder:text-[var(--color-fg-muted)]/60"
              maxLength={charLimit}
            />
            <div className={cn("absolute bottom-3 right-3 text-[11px] font-mono px-2.5 py-1 rounded-md transition-colors",
              charCount > charLimit * 0.9 ? "bg-[var(--color-error)]/10 text-[var(--color-error)]" : "bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]"
            )}>{charCount}/{charLimit}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--color-fg-muted)]">مرفقات:</span>
            <input ref={imageRef} type="file" accept="image/*,video/*" multiple className="hidden"
              onChange={e => { if (e.target.files) setImages(prev => [...prev, ...Array.from(e.target.files!)].slice(0, 4)); }} />
            <button type="button" className="flex items-center gap-2 text-sm h-9 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-2)] transition-colors" onClick={() => imageRef.current?.click()}>
              <Paperclip className="size-4" />
              {images.length > 0 ? `تم إرفاق ${images.length} ملف` : "إرفاق صور / فيديو"}
            </button>
            {images.length > 0 && (
              <button type="button" className="flex items-center gap-1 h-9 px-2 text-sm text-[var(--color-error)] hover:bg-[var(--color-error)]/10 rounded-lg transition-colors" onClick={() => setImages([])}>
                <X className="size-3" /> إزالة
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* RIGHT: Groups + Settings */}
      <div className="xl:col-span-2 space-y-5">
        {/* Groups List */}
        <Card className="border-2 border-[var(--color-border)]">
          <CardHeader className="pb-2 px-5 pt-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><Hash className="size-4 text-[var(--color-fg-muted)]" />قائمة الجروبات</CardTitle>
              <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs h-7 px-2">
                {selected.size === preselected.length ? "إلغاء الكل" : "تحديد الكل"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {preselected.length === 0 ? (
              <div className="text-center py-10 px-5">
                <Hash className="size-10 text-[var(--color-fg-muted)]/30 mx-auto mb-3" />
                <p className="text-sm text-[var(--color-fg-muted)]">لم تحدد أي جروب بعد.</p>
                <p className="text-xs text-[var(--color-fg-muted)]/70 mt-1">اذهب إلى تبويب "جروباتي" واختر الجروبات التي تريد النشر فيها.</p>
              </div>
            ) : (
              <div className="max-h-[340px] overflow-y-auto">
                {preselected.map((g, i) => (
                  <button
                    key={g.id}
                    onClick={() => toggleGroup(g.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-5 py-3 text-left transition-colors border-b border-[var(--color-border)] last:border-0",
                      selected.has(g.id) ? "bg-[var(--color-primary)]/5" : "hover:bg-[var(--color-surface-2)]"
                    )}
                  >
                    <div className={cn("size-[18px] rounded-[5px] border-2 flex items-center justify-center shrink-0 transition-all",
                      selected.has(g.id) ? "border-[var(--color-primary)] bg-[var(--color-primary)] scale-100" : "border-[var(--color-border)] scale-90"
                    )}>
                      {selected.has(g.id) && <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{g.name}</p>
                    </div>
                    <span className="text-[10px] text-[var(--color-fg-muted)] shrink-0 bg-[var(--color-surface-2)] px-2 py-0.5 rounded-full">{i % 5 === 0 ? "اختيار" : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Settings */}
        <Card className="border-2 border-[var(--color-border)]">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-3 mb-1">
              <div className={cn("p-2.5 rounded-xl", selectedIds.length > 0 ? "bg-[var(--color-primary)]/10" : "bg-[var(--color-surface-2)]")}>
                <Hash className={cn("size-5", selectedIds.length > 0 ? "text-[var(--color-primary)]" : "text-[var(--color-fg-muted)]")} />
              </div>
              <div>
                <p className="text-2xl font-bold tracking-tight">{selectedIds.length}</p>
                <p className="text-[11px] text-[var(--color-fg-muted)]">جروب محدد للنشر</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wider mb-1.5 block">أقل تأخير</label>
                <div className="relative">
                  <input type="number" value={delayMin} onChange={e => setDelayMin(+e.target.value)}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" min={10} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--color-fg-muted)]">ث</span>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wider mb-1.5 block">أقصى تأخير</label>
                <div className="relative">
                  <input type="number" value={delayMax} onChange={e => setDelayMax(+e.target.value)}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" min={10} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--color-fg-muted)]">ث</span>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5 pt-1">
              <Checkbox id="skipR" checked={skipRestricted} onChange={(e: any) => setSkipRestricted(e.target.checked)} className="mt-0.5" />
              <label htmlFor="skipR" className="text-sm text-[var(--color-fg-muted)] cursor-pointer leading-snug">تخطي الجروبات التي لا تسمح بالنشر</label>
            </div>

            <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)] bg-[var(--color-primary)]/5 px-3 py-2.5 rounded-lg border border-[var(--color-primary)]/10">
              <Settings2 className="size-3.5 text-[var(--color-primary)]" />
              <span>النشر بالدفعات: <span className="font-semibold text-[var(--color-fg)]">5 رسائل</span> كل <span className="font-semibold text-[var(--color-fg)]">50 ثانية</span></span>
            </div>
          </CardContent>
        </Card>

        {/* Action */}
        <Button
          className="w-full h-12 text-base font-semibold gap-2 rounded-xl shadow-lg shadow-[var(--color-primary)]/20 hover:shadow-xl hover:shadow-[var(--color-primary)]/30 transition-all"
          size="lg"
          onClick={handleStart}
          disabled={!message.trim() || selectedIds.length === 0 || !sessionId}
        >
          <Send className="size-5" /> بدء النشر في {selectedIds.length} جروب
        </Button>

        {!sessionId && (
          <div className="flex items-center gap-2 justify-center text-sm text-[var(--color-warning)] bg-[var(--color-warning)]/5 py-3 rounded-lg border border-[var(--color-warning)]/20">
            <div className="size-2 rounded-full bg-[var(--color-warning)]" /> الجلسة غير متصلة
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 justify-center text-sm text-[var(--color-error)] bg-[var(--color-error)]/5 py-3 rounded-lg border border-[var(--color-error)]/20">{error}</div>
        )}
      </div>
    </div>
  );
}
