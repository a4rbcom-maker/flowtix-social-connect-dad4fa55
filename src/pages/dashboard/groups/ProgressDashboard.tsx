import { useState, useEffect, type ReactNode } from "react";
import { Loader2, CheckCircle2, XCircle, SkipForward, Clock, Eye, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

interface Props {
  jobId: string;
  onDone: () => void;
  groups: { id: string; name: string }[];
}

const API_KEY = import.meta.env.VITE_EXTRACTION_API_KEY || "";
const API_URL = import.meta.env.VITE_EXTRACTION_API_URL || "";

type GroupState = "pending" | "publishing" | "posted" | "review" | "fail" | "skip";

/** Backend result reasons → clear Arabic labels (unknown reasons shown as-is). */
const REASON_AR: Record<string, string> = {
  composer_not_found: "الجروب لا يسمح بالنشر عليه (لا يوجد محرر منشورات)",
  pending_admin_approval: "المنشور مُرسل — بانتظار موافقة إدارة الجروب",
  submit_disabled: "لم تُسجّل الكتابة — زر النشر لم يُفعّل",
  typing_failed: "فشل إدخال النص في محرر فيسبوك",
  media_failed: "فشل إرفاق الصورة/الفيديو",
  no_confirmation: "لم يتم التأكد من ظهور المنشور في الجروب",
  navigation_error: "تعذّر فتح صفحة الجروب — الشبكة أو البروكسي لا يستجيب",
  media_download_failed: "فشل تحميل مرفقات المنشور قبل البدء",
  network_down: "توقّف النشر — انقطعت الشبكة أو البروكسي (المهمة قابلة للاستئناف)",
};

function displayReason(reason?: string): string | null {
  if (!reason) return null;
  // "navigation_error: <detail>" already carries an Arabic detail — show it.
  const navMatch = /^navigation_error:\s*(.+)$/s.exec(reason);
  if (navMatch) return navMatch[1].slice(0, 140);
  const key = reason.split(":")[0].trim();
  return REASON_AR[key] ?? (reason.length > 90 ? reason.slice(0, 90) + "…" : reason);
}

function groupName(id: string, groups: Props["groups"]): string {
  return groups.find(g => g.id === id)?.name || `جروب ${id.slice(0, 8)}`;
}

export function ProgressDashboard({ jobId, onDone, groups }: Props) {
  const [job, setJob] = useState<any>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const { data } = await (supabase as any).from("publish_jobs").select("*").eq("id", jobId).single();
        if (!mounted) return;
        setNow(Date.now());
        if (data) setJob(data);
      } catch { /* ignore - RLS might block, but we keep polling */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { mounted = false; clearInterval(interval); };
  }, [jobId]);

  const doAction = async (action: string) => {
    // session_id lives on the job row server-side; resume() falls back to it.
    await fetch(`${API_URL}/publish/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
      body: JSON.stringify({ job_id: jobId }),
    });
  };

  if (!job) return <div className="flex justify-center py-12"><Loader2 className="size-8 animate-spin text-[var(--color-primary)]" /></div>;

  const status: string = job.status;
  const terminal = status === "completed" || status === "failed" || status === "canceled";
  const p = job.progress || {};

  // Latest result row per group (worker appends; retries overwrite).
  const byGroup = new Map<string, any>();
  for (const r of job.results || []) {
    if (r?.group_id) byGroup.set(r.group_id, r);
  }

  const orderedIds: string[] = job.config?.group_ids || groups.map(g => g.id);
  const posted = byGroup.size > 0 ? [...byGroup.values()].filter(r => r.status === "posted").length : (p.published || 0);
  const review = [...byGroup.values()].filter(r => r.status === "review").length;
  const failed = [...byGroup.values()].filter(r => r.status === "fail").length;
  const skipped = [...byGroup.values()].filter(r => r.status === "skip").length;
  const done = posted + review + failed + skipped;
  const total = Math.max(orderedIds.length, 1);
  const pct = Math.round((done / total) * 100);

  // Stall detector: a "running" job with no DB write for 3+ minutes is not normal
  // — surface it instead of leaving the user staring at a silent spinner.
  const staleMin = status === "running" && job.updated_at
    ? Math.floor((now - new Date(job.updated_at).getTime()) / 60000)
    : 0;
  const stalled = status === "running" && staleMin >= 3;

  const stateOf = (gid: string): GroupState => {
    const r = byGroup.get(gid);
    if (r) {
      if (r.status === "posted") return "posted";
      if (r.status === "review") return "review";
      if (r.status === "fail") return "fail";
      if (r.status === "skip") return "skip";
    }
    if (terminal) return "skip"; // never reached before the job ended
    if (p.current_group === gid && status === "running") return "publishing";
    return "pending";
  };

  const stateMeta: Record<GroupState, { icon: ReactNode; label: string; cls: string }> = {
    pending: { icon: <Clock className="size-3.5 text-[var(--color-fg-muted)] shrink-0" />, label: "في الانتظار", cls: "text-[var(--color-fg-muted)]" },
    publishing: { icon: <Loader2 className="size-3.5 animate-spin text-[var(--color-primary)] shrink-0" />, label: "جاري النشر", cls: "text-[var(--color-primary)]" },
    posted: { icon: <CheckCircle2 className="size-3.5 text-[var(--color-success)] shrink-0" />, label: "تم النشر", cls: "text-[var(--color-success)]" },
    review: { icon: <Eye className="size-3.5 text-[var(--color-info)] shrink-0" />, label: "يحتاج مراجعة", cls: "text-[var(--color-info)]" },
    fail: { icon: <XCircle className="size-3.5 text-[var(--color-error)] shrink-0" />, label: "فشل", cls: "text-[var(--color-error)]" },
    skip: { icon: <SkipForward className="size-3.5 text-[var(--color-warning)] shrink-0" />, label: "غير قابل للنشر", cls: "text-[var(--color-warning)]" },
  };

  const currentName = p.current_group ? groupName(p.current_group, groups) : null;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {status === "running" && <Loader2 className="size-4 animate-spin text-[var(--color-primary)]" />}
              {status === "paused" && <Clock className="size-4 text-[var(--color-warning)]" />}
              {status === "completed" && <CheckCircle2 className="size-4 text-[var(--color-success)]" />}
              {status === "failed" && <XCircle className="size-4 text-[var(--color-error)]" />}
              {status === "canceled" && <XCircle className="size-4 text-[var(--color-warning)]" />}
              <span className="text-sm font-semibold">
                {terminal ? "النتيجة النهائية" : status === "running" ? "جاري النشر…" : "متوقف مؤقتًا — يمكن الاستئناف"}
              </span>
            </div>
            <span className="text-xs text-[var(--color-fg-muted)] tabular-nums">{done}/{total} ({pct}%)</span>
          </div>

          <div className="w-full bg-[var(--color-surface-2)] rounded-full h-3 overflow-hidden">
            <div className="bg-[var(--color-primary)] h-3 rounded-full transition-all duration-700 ease-out" style={{ width: `${pct}%`, minWidth: pct > 0 ? "2%" : "0" }} />
          </div>

          {/* Live position */}
          {status === "running" && currentName && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-fg-muted)] bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/10 rounded-lg px-3 py-2.5">
              <Loader2 className="size-3.5 animate-spin text-[var(--color-primary)] shrink-0" />
              <span>جاري النشر على: <span className="font-semibold text-[var(--color-fg)]">{currentName}</span></span>
            </div>
          )}
          {p.abort_reason === "network_down" && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-warning)] bg-[var(--color-warning)]/5 border border-[var(--color-warning)]/20 rounded-lg px-3 py-2.5">
              <Clock className="size-3.5 shrink-0" />
              <span>توقّف النشر تلقائيًا: انقطعت الشبكة أو البروكسي بعد محاولتين متتاليتين. صلّح الاتصال ثم اضغط «استئناف» — الجروبات المنشورة لن تُكرَّر.</span>
            </div>
          )}
          {stalled && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-warning)] bg-[var(--color-warning)]/5 border border-[var(--color-warning)]/20 rounded-lg px-3 py-2.5">
              <Clock className="size-3.5 shrink-0" />
              <span>لم يصل أي تحديث منذ {staleMin} دقيقة — قد تكون خدمة النشر متوقفة. جرّب التحديث أو أعد ربط الجلسة.</span>
            </div>
          )}

          <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
            {([
              [total, "إجمالي الجروبات", "text-[var(--color-fg)]"],
              [posted, "تم النشر", "text-[var(--color-success)]"],
              [review, "يحتاج مراجعة", "text-[var(--color-info)]"],
              [failed, "فشل", "text-[var(--color-error)]"],
              [skipped, "مستبعد قبل النشر", "text-[var(--color-warning)]"],
            ] as [number, string, string][]).map(([val, label, cls]) => (
              <div key={label} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3 text-center">
                <p className={cn("text-xl font-bold tabular-nums", cls)}>{val}</p>
                <p className="text-[11px] text-[var(--color-fg-muted)] mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-2 justify-center">
            <Button variant="outline" size="sm" onClick={() => doAction("pause")} disabled={status !== "running"}>
              <Clock className="size-3" /> إيقاف مؤقت
            </Button>
            <Button variant="outline" size="sm" onClick={() => doAction("resume")} disabled={status !== "paused"}>
              <Loader2 className="size-3" /> استئناف
            </Button>
            <Button variant="outline" size="sm" onClick={() => doAction("stop")} disabled={terminal}>
              <XCircle className="size-3" /> إيقاف
            </Button>
            {terminal && (
              <Button size="sm" onClick={onDone} className="gap-2">
                <ExternalLink className="size-3" /> عملية نشر جديدة
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Per-group results */}
      <Card>
        <CardContent className="p-4 max-h-[420px] overflow-y-auto space-y-1">
          <p className="text-xs font-medium text-[var(--color-fg-muted)] mb-2">نتيجة كل جروب</p>
          {orderedIds.map((gid) => {
            const st = stateOf(gid);
            const row = byGroup.get(gid);
            const reason = displayReason(row?.reason);
            const meta = stateMeta[st];
            return (
              <div key={gid} className="flex items-center gap-2.5 text-xs py-2 border-b border-[var(--color-border)] last:border-0">
                {meta.icon}
                <span className="font-medium truncate max-w-[180px] sm:max-w-[260px]">{groupName(gid, groups)}</span>
                <span className={cn("shrink-0", meta.cls)}>{meta.label}</span>
                {reason && st !== "posted" && st !== "pending" && (
                  <span className="text-[var(--color-fg-muted)] truncate" title={row?.reason}>— {reason}</span>
                )}
                {st === "posted" && row?.post_url && (
                  <a
                    href={row.post_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mr-auto shrink-0 inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline font-medium"
                  >
                    <ExternalLink className="size-3" /> فتح المنشور
                  </a>
                )}
                {st === "posted" && !row?.post_url && (
                  <a
                    href={`https://www.facebook.com/groups/${gid}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="mr-auto shrink-0 inline-flex items-center gap-1 text-[var(--color-fg-muted)] hover:underline text-[11px]"
                  >
                    <ExternalLink className="size-3" /> فتح الجروب
                  </a>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
