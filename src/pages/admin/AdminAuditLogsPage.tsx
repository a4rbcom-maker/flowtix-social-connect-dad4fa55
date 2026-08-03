import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ScrollText, Search, Download, Eye, ChevronLeft, ChevronRight,
  Calendar, User, Activity, FileJson, X,
} from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Select } from "@/components/ui/dropdown";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { LoadingState, EmptyState } from "@/components/ui/state";
import { LineChart } from "@/components/admin/LineChart";
import {
  useAdminAuditLogs, useAdminAuditLogCount, useAdminAuditStats,
  useAdminAuditTrend, useAdminAuditLog, useExportAuditLogs,
} from "@/hooks/useAdmin";
import type { AdminAuditLog, AdminAuditLogFilters } from "@/types/admin.types";
import { AUDIT_ACTION_LABELS, ACTION_BADGE_VARIANT } from "@/types/admin.types";

const PAGE_SIZE = 20;

export function AdminAuditLogsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? "ar" : "en";

  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  const filters: AdminAuditLogFilters = useMemo(() => ({
    search: search.trim() || undefined,
    action: action || undefined,
    resource_type: resourceType || undefined,
    date_from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    date_to: dateTo ? new Date(dateTo + "T23:59:59").toISOString() : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [search, action, resourceType, dateFrom, dateTo, page]);

  const { data: logs, isLoading } = useAdminAuditLogs(filters);
  const { data: total } = useAdminAuditLogCount(filters);
  const { data: stats } = useAdminAuditStats();
  const { data: trend } = useAdminAuditTrend(30);

  const totalPages = total ? Math.ceil(total / PAGE_SIZE) : 0;

  const exportMutation = useExportAuditLogs();

  const resetFilters = () => {
    setSearch(""); setAction(""); setResourceType("");
    setDateFrom(""); setDateTo(""); setPage(0);
  };

  const hasActiveFilters = search || action || resourceType || dateFrom || dateTo;

  const handleExport = (format: "csv" | "json") => {
    const exportFilters: AdminAuditLogFilters = {
      search: search.trim() || undefined,
      action: action || undefined,
      resource_type: resourceType || undefined,
      date_from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
      date_to: dateTo ? new Date(dateTo + "T23:59:59").toISOString() : undefined,
    };
    exportMutation.mutate(exportFilters, {
      onSuccess: (data) => {
        if (format === "json") {
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          downloadBlob(blob, `audit-logs-${Date.now()}.json`);
        } else {
          const csv = convertToCSV(data);
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
          downloadBlob(blob, `audit-logs-${Date.now()}.csv`);
        }
        toast({ type: "success", title: t("admin.auditLogs.exported", { count: data.length }) });
      },
      onError: () => toast({ type: "error", title: t("common.error") }),
    });
  };

  const actionOptions = useMemo(() => {
    const opts = [{ value: "", label: t("admin.auditLogs.allActions") }];
    for (const [key, label] of Object.entries(AUDIT_ACTION_LABELS)) {
      opts.push({ value: key, label: label[locale] });
    }
    return opts;
  }, [t, locale]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.auditLogs.title")}
        description={t("admin.auditLogs.description")}
        icon={ScrollText}
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleExport("csv")} loading={exportMutation.isPending} className="gap-2">
              <Download size={16} />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("json")} loading={exportMutation.isPending} className="gap-2">
              <FileJson size={16} />
              JSON
            </Button>
          </div>
        }
      />

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label={t("admin.auditLogs.totalLogs")} value={stats.total_logs} icon={ScrollText} />
          <StatCard label={t("admin.auditLogs.today")} value={stats.today_count} icon={Activity} />
          <StatCard label={t("admin.auditLogs.thisWeek")} value={stats.week_count} icon={Calendar} />
          <StatCard label={t("admin.auditLogs.uniqueUsersToday")} value={stats.unique_users_today} icon={User} />
        </div>
      )}

      {trend && trend.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("admin.auditLogs.trend30Days")}</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart data={trend.map((d) => ({ label: d.date, value: d.count }))} height={200} />
          </CardContent>
        </Card>
      )}

      {stats && stats.top_actions && stats.top_actions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("admin.auditLogs.topActions")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.top_actions.map((item, idx) => {
                const label = AUDIT_ACTION_LABELS[item.action]?.[locale] ?? item.action;
                const maxCount = stats.top_actions[0]?.count || 1;
                const pct = (item.count / maxCount) * 100;
                return (
                  <div key={idx} className="flex items-center gap-3">
                    <div className="w-32 text-sm shrink-0">{label}</div>
                    <div className="flex-1 h-6 bg-[var(--color-surface)] rounded-md overflow-hidden">
                      <div
                        className="h-full bg-[var(--color-primary)] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <Badge variant="outline">{item.count}</Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2 relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-fg-muted)] pointer-events-none" />
              <Input
                placeholder={t("admin.auditLogs.searchPlaceholder")}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="ps-9"
              />
            </div>
            <Select
              value={action}
              onValueChange={(val) => { setAction(val); setPage(0); }}
              options={actionOptions}
            />
            <Input
              placeholder={t("admin.auditLogs.resourceTypePlaceholder")}
              value={resourceType}
              onChange={(e) => { setResourceType(e.target.value); setPage(0); }}
            />
            <div className="flex gap-2">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
                className="min-w-0 flex-1"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
                className="min-w-0 flex-1"
              />
            </div>
          </div>
          {hasActiveFilters && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-[var(--color-fg-muted)]">
                {t("admin.auditLogs.showingResults", { count: total ?? 0 })}
              </span>
              <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-2 self-start sm:self-auto">
                <X size={14} />
                {t("admin.auditLogs.clearFilters")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <LoadingState />
          ) : !logs?.length ? (
            <EmptyState title={t("admin.auditLogs.noLogs")} icon={ScrollText} />
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("admin.auditLogs.colAction")}</TableHead>
                      <TableHead>{t("admin.auditLogs.colUser")}</TableHead>
                      <TableHead>{t("admin.auditLogs.colResource")}</TableHead>
                      <TableHead>{t("admin.auditLogs.colDescription")}</TableHead>
                      <TableHead>{t("admin.auditLogs.colDate")}</TableHead>
                      <TableHead className="text-end">{t("common.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <AuditLogRow key={log.id} log={log} onView={() => setSelectedLogId(log.id)} />
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3 p-3">
                {logs.map((log) => (
                  <AuditLogMobileCard key={log.id} log={log} onView={() => setSelectedLogId(log.id)} />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-[var(--color-fg-muted)]">
            {t("admin.auditLogs.pageOf", { page: page + 1, total: totalPages })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="gap-2 flex-1 sm:flex-none"
            >
              <ChevronLeft size={16} />
              {t("common.prev")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="gap-2 flex-1 sm:flex-none"
            >
              {t("common.next")}
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {selectedLogId && (
        <AuditLogDetailDialog logId={selectedLogId} onClose={() => setSelectedLogId(null)} />
      )}
    </div>
  );
}

function AuditLogRow({ log, onView }: { log: AdminAuditLog; onView: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? "ar" : "en";

  const actionLabel = AUDIT_ACTION_LABELS[log.action]?.[locale] ?? log.action;
  const badgeVariant = ACTION_BADGE_VARIANT[log.action] ?? "default";

  return (
    <TableRow>
      <TableCell>
        <Badge variant={badgeVariant}>{actionLabel}</Badge>
      </TableCell>
      <TableCell>
        <div className="text-sm">
          <div className="font-medium">{log.user_name || log.user_email || t("admin.auditLogs.unknownUser")}</div>
          {log.user_name && log.user_email && (
            <div className="text-xs text-[var(--color-fg-muted)]">{log.user_email}</div>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="text-sm">
          {log.resource_type ? (
            <>
              <div className="font-medium">{log.resource_type}</div>
              {log.resource_id && (
                <code className="text-xs text-[var(--color-fg-muted)]">{log.resource_id.substring(0, 8)}...</code>
              )}
            </>
          ) : (
            <span className="text-[var(--color-fg-muted)]">—</span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <span className="text-sm truncate max-w-[300px] block">{log.description || "—"}</span>
      </TableCell>
      <TableCell>
        <span className="text-xs text-[var(--color-fg-muted)] whitespace-nowrap">
          {formatDateTime(log.created_at, locale)}
        </span>
      </TableCell>
      <TableCell className="text-end">
        <Button variant="ghost" size="sm" onClick={onView}>
          <Eye size={14} />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function AuditLogMobileCard({ log, onView }: { log: AdminAuditLog; onView: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? "ar" : "en";
  const actionLabel = AUDIT_ACTION_LABELS[log.action]?.[locale] ?? log.action;
  const badgeVariant = ACTION_BADGE_VARIANT[log.action] ?? "default";
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <Badge variant={badgeVariant}>{actionLabel}</Badge>
        <span className="text-xs text-[var(--color-fg-muted)] shrink-0">
          {formatDateTime(log.created_at, locale)}
        </span>
      </div>
      <div>
        <p className="text-sm font-medium truncate">{log.user_name || log.user_email || t("admin.auditLogs.unknownUser")}</p>
        {log.user_name && log.user_email && (
          <p className="text-xs text-[var(--color-fg-muted)] truncate">{log.user_email}</p>
        )}
      </div>
      {log.resource_type && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--color-fg-muted)]">{t("admin.auditLogs.colResource")}</span>
          <span className="font-medium">{log.resource_type}</span>
        </div>
      )}
      {log.description && (
        <p className="text-xs text-[var(--color-fg-muted)] line-clamp-2">{log.description}</p>
      )}
      <Button variant="ghost" size="sm" onClick={onView} className="w-full gap-2">
        <Eye size={14} />
        {t("common.view")}
      </Button>
    </div>
  );
}

function AuditLogDetailDialog({ logId, onClose }: { logId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? "ar" : "en";
  const { data: log, isLoading } = useAdminAuditLog(logId);

  const actionLabel = log ? (AUDIT_ACTION_LABELS[log.action]?.[locale] ?? log.action) : "";
  const badgeVariant = log ? (ACTION_BADGE_VARIANT[log.action] ?? "default") : "default";

  return (
    <Dialog open={true} onClose={onClose}>
      <div className="w-full sm:max-w-2xl flex flex-col max-h-[95vh] sm:max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <ScrollText size={18} />
            {t("admin.auditLogs.detailTitle")}
          </DialogTitle>
          <DialogClose onClose={onClose} />
        </DialogHeader>
        <DialogBody>
          {isLoading || !log ? (
            <LoadingState />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-2 pb-3 border-b border-[var(--color-border)] sm:flex-row sm:items-center sm:gap-3">
                <Badge variant={badgeVariant}>{actionLabel}</Badge>
                <span className="text-xs sm:text-sm text-[var(--color-fg-muted)]">
                  {formatDateTime(log.created_at, locale)}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <DetailItem label={t("admin.auditLogs.user")} value={log.user_name || log.user_email || t("admin.auditLogs.unknownUser")} />
                <DetailItem label={t("admin.auditLogs.email")} value={log.user_email || "—"} />
                <DetailItem label={t("admin.auditLogs.workspace")} value={log.workspace_name || "—"} />
                <DetailItem label={t("admin.auditLogs.ip")} value={log.ip ? String(log.ip) : "—"} />
              </div>

              <DetailItem label={t("admin.auditLogs.resourceType")} value={log.resource_type || "—"} />
              {log.resource_id && <DetailItem label={t("admin.auditLogs.resourceId")} value={log.resource_id} mono />}

              {log.description && <DetailItem label={t("admin.auditLogs.description")} value={log.description} />}

              {log.user_agent && <DetailItem label={t("admin.auditLogs.userAgent")} value={log.user_agent} mono small />}

              {log.metadata && Object.keys(log.metadata).length > 0 && (
                <div>
                  <Label className="mb-2 block">{t("admin.auditLogs.metadata")}</Label>
                  <pre className="p-3 rounded-lg bg-[var(--color-bg)] text-[var(--color-fg-muted)] text-xs font-mono overflow-x-auto max-h-60">
                    {JSON.stringify(log.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

function DetailItem({
  label, value, mono = false, small = false,
}: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div>
      <Label className="text-xs text-[var(--color-fg-muted)] mb-1 block">{label}</Label>
      <div className={`${mono ? "font-mono" : ""} ${small ? "text-xs" : "text-sm"} break-all`}>{value}</div>
    </div>
  );
}

function formatDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  return d.toLocaleString(locale === "ar" ? "ar-EG" : "en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function convertToCSV(data: AdminAuditLog[]): string {
  const headers = [
    "id", "user_email", "user_name", "workspace_name",
    "action", "resource_type", "resource_id", "description",
    "metadata", "ip", "user_agent", "created_at",
  ];
  const rows = data.map((log) => [
    log.id,
    log.user_email ?? "",
    log.user_name ?? "",
    log.workspace_name ?? "",
    log.action,
    log.resource_type ?? "",
    log.resource_id ?? "",
    (log.description ?? "").replace(/"/g, '""'),
    JSON.stringify(log.metadata ?? {}),
    log.ip ? String(log.ip) : "",
    (log.user_agent ?? "").replace(/"/g, '""'),
    log.created_at,
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${cell}"`).join(","))
    .join("\n");
  return "\uFEFF" + csv;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
