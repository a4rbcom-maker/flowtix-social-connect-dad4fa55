import { useTranslation } from "react-i18next";
import { Receipt, Download } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const invoices = [
  { id: "INV-2026-007", date: "Jul 20, 2026", amount: "$79.00", status: "paid" },
  { id: "INV-2026-006", date: "Jun 20, 2026", amount: "$79.00", status: "paid" },
  { id: "INV-2026-005", date: "May 20, 2026", amount: "$79.00", status: "paid" },
  { id: "INV-2026-004", date: "Apr 20, 2026", amount: "$29.00", status: "paid" },
  { id: "INV-2026-003", date: "Mar 20, 2026", amount: "$29.00", status: "paid" },
];

export function BillingPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader title={t("pages.billing.title")} description={t("pages.billing.subtitle")} icon={Receipt} />

      <Card hover="lift">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t("pages.billing.invoices")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="py-3 px-4 text-start font-semibold text-[var(--color-fg-muted)]">{t("pages.billing.invoiceNumber")}</th>
                  <th className="py-3 px-4 text-start font-semibold text-[var(--color-fg-muted)]">{t("pages.billing.date")}</th>
                  <th className="py-3 px-4 text-start font-semibold text-[var(--color-fg-muted)]">{t("pages.billing.amount")}</th>
                  <th className="py-3 px-4 text-start font-semibold text-[var(--color-fg-muted)]">{t("pages.billing.status")}</th>
                  <th className="py-3 px-4 text-end font-semibold text-[var(--color-fg-muted)]">{t("pages.billing.download")}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-2)]">
                    <td className="py-3 px-4 font-medium text-[var(--color-fg)]">{inv.id}</td>
                    <td className="py-3 px-4 text-[var(--color-fg-muted)]">{inv.date}</td>
                    <td className="py-3 px-4 font-semibold text-[var(--color-fg)]">{inv.amount}</td>
                    <td className="py-3 px-4"><Badge variant="success">{t("pages.billing.paid")}</Badge></td>
                    <td className="py-3 px-4 text-end">
                      <Button variant="ghost" size="icon" className="size-8"><Download className="size-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
