import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Send, ArrowLeft, Users, Loader2, MessageCircle, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { toast } from "@/components/ui/toast";

export function MessengerBroadcastPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    (async () => {
      const { data } = await supabase.from("extraction_jobs").select("*").eq("id", jobId).single();
      setJob(data);
      setLoading(false);
    })();
  }, [jobId]);

  const handleSend = async () => {
    if (!message.trim() || !jobId || !job) return;
    setSending(true);
    try {
      const apiUrl = import.meta.env.VITE_EXTRACTION_API_URL || "http://localhost:3100";
      const apiKey = import.meta.env.VITE_EXTRACTION_API_KEY || "";
      const res = await fetch(`${apiUrl}/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ job_id: jobId, message: message.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error?.message || "Broadcast failed");
      }
      const result = await res.json();
      toast({ type: "success", title: `تم بدء الإرسال إلى ${result.contact_count || job.result_count} جهة` });
      setSent(true);
    } catch (err: any) {
      toast({ type: "error", title: "فشل الإرسال", description: err.message });
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-20">
        <p className="text-[var(--color-fg-muted)]">المهمة غير موجودة</p>
        <Button variant="ghost" onClick={() => navigate("/dashboard/tasks")} className="mt-3">
          <ArrowLeft className="size-4" /> العودة للمهام
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <PageHeader title="إرسال رسالة جماعية" />

      <Card>
        <CardContent className="p-6 space-y-4">
          {/* Job info */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--color-surface-2)]">
            <div className="flex size-10 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)] text-[var(--color-success)]">
              <MessageCircle className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">{job.name}</p>
              <p className="text-xs text-[var(--color-fg-muted)]">
                <Users className="size-3 inline me-1" />
                {job.result_count || 0} جهة اتصال
              </p>
            </div>
          </div>

          {sent ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <CheckCircle2 className="size-16 text-[var(--color-success)]" />
              <p className="text-lg font-semibold text-center">تم بدء الإرسال بنجاح!</p>
              <p className="text-sm text-[var(--color-fg-muted)] text-center">
                سيتم إرسال الرسالة إلى {job.result_count} جهة اتصال في الخلفية
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => navigate("/dashboard/tasks")}>
                  <ArrowLeft className="size-4" /> العودة للمهام
                </Button>
                <Button onClick={() => { setSent(false); setMessage(""); }}>
                  إرسال رسالة أخرى
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Message composer */}
              <div>
                <label className="block text-sm font-medium mb-2">نص الرسالة</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="اكتب رسالتك هنا..."
                  className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-sm resize-none focus:border-[var(--color-primary)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/10"
                  rows={5}
                  dir="auto"
                />
                <p className="text-xs text-[var(--color-fg-subtle)] mt-1.5">
                  يمكنك استخدام الرموز: {"{{"}name{"}}"} للاسم
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => navigate("/dashboard/tasks")}>
                  <ArrowLeft className="size-4" /> رجوع
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleSend}
                  disabled={sending || !message.trim()}
                >
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  {sending ? "جاري الإرسال..." : `إرسال إلى ${job.result_count || 0} جهة`}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
