import { useState, useEffect, useRef } from "react";
import { Loader2, CheckCircle2, XCircle, SkipForward, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

interface Props { jobId: string; onDone: () => void; }

const API_KEY = import.meta.env.VITE_EXTRACTION_API_KEY || "";
const API_URL = import.meta.env.VITE_EXTRACTION_API_URL || "";

export function ProgressDashboard({ jobId, onDone }: Props) {
  const [job, setJob] = useState<any>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const { data } = await (supabase as any).from("publish_jobs").select("*").eq("id", jobId).single();
        if (!mounted) return;
        if (data) {
          setJob(data);
          const s = data.status;
          if (!doneRef.current && (s === "completed" || s === "failed" || s === "canceled")) {
            doneRef.current = true;
            setTimeout(() => onDone(), 3000);
          }
        }
      } catch { /* ignore - RLS might block, but we keep polling */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { mounted = false; clearInterval(interval); };
  }, [jobId]);

  const doAction = async (action: string) => {
    // session_id lives on the job row server-side; sending an empty string
    // would fail backend validation. resume() falls back to the recorded session.
    await fetch(`${API_URL}/publish/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
      body: JSON.stringify({ job_id: jobId }),
    });
  };

  if (!job) return <div className="flex justify-center py-12"><Loader2 className="size-8 animate-spin text-[var(--color-primary)]" /></div>;

  const p = job.progress || {};
  const pub = (p.published || 0) as number;
  const fail = (p.failed || 0) as number;
  const skip = (p.skipped || 0) as number;
  const total = (job.config?.group_ids?.length || 1) as number;
  const done = pub + fail + skip;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {[
          [total, "مجموع", "text-[var(--color-fg)]"],
          [pub, "تم", "text-[var(--color-success)]"],
          [fail, "فشل", "text-[var(--color-error)]"],
          [skip, "تخطي", "text-[var(--color-warning)]"],
        ].map(([val, label, cls]) => (
          <Card key={label as string}>
            <CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold tabular-nums ${cls}`}>{val as number}</p>
              <p className="text-xs text-[var(--color-fg-muted)]">{label as string}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Progress Bar */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium tabular-nums">{done}/{total} ({pct}%)</span>
            <div className="flex items-center gap-2">
              {job.status === "queued" && <span className="text-xs text-[var(--color-fg-muted)] flex items-center gap-1"><Clock className="size-3" /> في الانتظار</span>}
              {job.status === "running" && <Loader2 className="size-4 animate-spin text-[var(--color-primary)]" />}
              {job.status === "completed" && <CheckCircle2 className="size-4 text-[var(--color-success)]" />}
              {job.status === "failed" && <XCircle className="size-4 text-[var(--color-error)]" />}
              {job.status === "canceled" && <XCircle className="size-4 text-[var(--color-warning)]" />}
              {job.status === "paused" && <Clock className="size-4 text-[var(--color-warning)]" />}
              <span className="text-xs text-[var(--color-fg-muted)]">
                {job.status === "queued" ? "في الانتظار" : job.status === "running" ? "جاري" : job.status === "completed" ? "مكتمل" : job.status === "failed" ? "فشل" : job.status === "canceled" ? "ملغي" : job.status === "paused" ? "متوقف مؤقتًا" : job.status}
              </span>
            </div>
          </div>
          <div className="w-full bg-[var(--color-surface-2)] rounded-full h-3 overflow-hidden">
            <div className="bg-[var(--color-primary)] h-3 rounded-full transition-all duration-700 ease-out" style={{ width: `${pct}%`, minWidth: pct > 0 ? "2%" : "0" }} />
          </div>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" size="sm" onClick={() => doAction("pause")} disabled={job.status !== "running"}>
              <Clock className="size-3" /> إيقاف مؤقت
            </Button>
            <Button variant="outline" size="sm" onClick={() => doAction("resume")} disabled={job.status !== "paused"}>
              <Loader2 className="size-3" /> استئناف
            </Button>
            <Button variant="outline" size="sm" onClick={() => doAction("stop")} disabled={job.status === "completed" || job.status === "canceled"}>
              <XCircle className="size-3" /> إيقاف
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results Log */}
      <Card>
        <CardContent className="p-4 max-h-64 overflow-y-auto space-y-1">
          <p className="text-xs font-medium text-[var(--color-fg-muted)] mb-2">سجل النشاط</p>
          {(job.results || []).slice(-20).reverse().map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-[var(--color-border)] last:border-0">
              {r.status === "ok" && <CheckCircle2 className="size-3 text-[var(--color-success)] shrink-0" />}
              {r.status === "fail" && <XCircle className="size-3 text-[var(--color-error)] shrink-0" />}
              {r.status === "skip" && <SkipForward className="size-3 text-[var(--color-warning)] shrink-0" />}
              <span className="text-[var(--color-fg-muted)]">جروب {r.group_id?.substring(0, 8)}</span>
              <span className={r.status === "ok" ? "text-[var(--color-success)]" : r.status === "fail" ? "text-[var(--color-error)]" : "text-[var(--color-warning)]"}>
                {r.status === "ok" ? "تم" : r.status === "fail" ? "فشل" : "تخطي"}
              </span>
              {r.at && <span className="text-[var(--color-fg-muted)] mr-auto text-[10px]">{new Date(r.at).toLocaleTimeString()}</span>}
            </div>
          ))}
          {(!job.results || job.results.length === 0) && (
            <p className="text-xs text-[var(--color-fg-muted)] text-center py-4">في انتظار أول نتيجة...</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
