import { useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useAuth } from "@/lib/authProvider";
import { useWaTemplates } from "@/hooks/useWaCampaigns";
import { waCampaignsRepository } from "@/lib/wa-campaigns";

export function WaTemplatesPage() {
  const { session: authSession } = useAuth();
  const ws = authSession?.user?.id || "";
  const { data: templates, isLoading } = useWaTemplates();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("marketing");
  const [body, setBody] = useState("");

  const handleSave = async () => {
    if (!ws || !name.trim() || !body.trim()) return;
    try {
      const vars = body.match(/\{\{(\w+)\}\}/g)?.map((m: string) => m.replace(/[{}]/g, "")) ?? [];
      await waCampaignsRepository.saveTemplate({ workspaceId: ws, name: name.trim(), category, type: "text", body: body.trim(), variables: vars, language: "ar" });
      setShowAdd(false); setName(""); setBody(""); toast({ type: "success", title: "تم حفظ القالب" });
    } catch {}
  };

  return (
    <div className="space-y-4">
      <PageHeader title="القوالب" description="قوالب رسائل قابلة لإعادة الاستخدام" />
      <Button onClick={() => setShowAdd(true)}><Plus className="size-4" /> قالب جديد</Button>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-1)]">
              <tr><th className="p-3 text-start">الاسم</th><th className="p-3 text-start">الفئة</th><th className="p-3 text-start hidden md:table-cell">المتغيرات</th><th className="p-3 text-start">اللغة</th><th className="p-3 w-16"></th></tr>
            </thead>
            <tbody>
              {isLoading ? <tr><td colSpan={5} className="p-4 text-center"><Loader2 className="size-5 animate-spin mx-auto" /></td></tr> :
               templates?.map(t => (
                <tr key={t.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)]">
                  <td className="p-3 font-medium">{t.name}</td>
                  <td className="p-3"><Badge variant="outline">{t.category || "—"}</Badge></td>
                  <td className="p-3 hidden md:table-cell text-[var(--color-fg-muted)] text-xs">{(t.variables ?? []).join(", ") || "—"}</td>
                  <td className="p-3">{t.language === "ar" ? "عربي" : t.language}</td>
                  <td className="p-3"><Button size="icon" variant="ghost" className="size-7" onClick={() => { if (confirm("حذف القالب؟")) waCampaignsRepository.deleteTemplate(t.id); }}><Trash2 className="size-3" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={showAdd} onClose={() => setShowAdd(false)}>
        <DialogHeader><DialogTitle>قالب جديد</DialogTitle><DialogClose onClose={() => setShowAdd(false)} /></DialogHeader>
        <DialogBody className="space-y-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="اسم القالب" className="w-full border rounded px-3 py-2 text-sm" />
          <select value={category} onChange={e => setCategory(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
            <option value="marketing">تسويقي</option><option value="utility">خدماتي</option><option value="auth">تحقق</option>
          </select>
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder='نص القالب... استخدم {{name}} {{phone}}' className="w-full border rounded px-3 py-2 text-sm min-h-[120px]" />
          <p className="text-[10px] text-[var(--color-fg-muted)]">استخدم {"{{name}}"} {"{{phone}}"} {"{{jid}}"} كمتغيرات</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowAdd(false)}>إلغاء</Button>
          <Button onClick={handleSave}>حفظ</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
