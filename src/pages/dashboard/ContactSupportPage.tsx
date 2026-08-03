import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MessagesSquare, Mail, Send } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { InputIcon } from "@/components/ui/input-icon";
import { Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/form";
import { Select } from "@/components/ui/dropdown";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function ContactSupportPage() {
  const { t } = useTranslation();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSubject(""); setMessage(""); setCategory("");
      toast({ type: "success", title: t("pages.contact.success") });
    }, 1200);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("pages.contact.title")} description={t("pages.contact.subtitle")} icon={MessagesSquare} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4">
          <Card hover="lift"><CardContent className="flex items-center gap-3 pt-6"><div className="flex size-10 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-[var(--color-primary)] shrink-0"><Mail className="size-5" /></div><div><p className="text-sm font-semibold text-[var(--color-fg)]">{t("pages.contact.email")}</p><p className="text-xs text-[var(--color-fg-muted)]">support@flowtix.tools</p></div></CardContent></Card>
          <Card hover="lift"><CardContent className="flex items-center gap-3 pt-6"><div className="flex size-10 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)] text-[var(--color-success)] shrink-0"><MessagesSquare className="size-5" /></div><div><p className="text-sm font-semibold text-[var(--color-fg)]">{t("pages.contact.liveChat")}</p><p className="text-xs text-[var(--color-fg-muted)]">{t("pages.contact.liveChatHours")}</p></div></CardContent></Card>
          <Card hover="lift"><CardContent className="text-center py-6"><p className="text-sm font-semibold text-[var(--color-fg)]">{t("pages.contact.responseTime")}</p>            <p className="mt-1 text-2xl font-extrabold text-[var(--color-primary)]">{"< 24h"}</p></CardContent></Card>
        </div>

        <Card className="lg:col-span-2" hover="lift">
          <CardHeader><CardTitle>{t("pages.contact.sendMessage")}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>{t("auth.fields.fullName")}</Label><InputIcon icon={MessagesSquare} placeholder="FlowTix User" required /></div>
                <div className="space-y-2"><Label>{t("auth.fields.email")}</Label><InputIcon icon={Mail} type="email" placeholder="name@example.com" required /></div>
              </div>
              <div className="space-y-2"><Label>{t("pages.contact.category")}</Label><Select value={category} onValueChange={setCategory} options={[{ value: "", label: t("pages.contact.selectCategory") }, { value: "general", label: t("pages.contact.categories.general") }, { value: "technical", label: t("pages.contact.categories.technical") }, { value: "billing", label: t("pages.contact.categories.billing") }, { value: "bug", label: t("pages.contact.categories.bug") }]} /></div>
              <div className="space-y-2"><Label>{t("pages.contact.subject")}</Label><InputIcon placeholder={t("pages.contact.subjectPlaceholder")} value={subject} onChange={(e) => setSubject(e.target.value)} required /></div>
              <div className="space-y-2"><Label>{t("pages.contact.message")}</Label><Textarea placeholder={t("pages.contact.messagePlaceholder")} value={message} onChange={(e) => setMessage(e.target.value)} rows={5} required /></div>
              <Button type="submit" loading={loading}><Send className="size-4" />{t("pages.contact.send")}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
