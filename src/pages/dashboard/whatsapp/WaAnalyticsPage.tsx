import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3, MessageSquare, Send, Inbox, CheckCheck, Eye, XCircle,
  Users, DollarSign, Bot, Clock, TrendingUp, Megaphone,
} from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/dropdown";
import { LoadingState, EmptyState } from "@/components/ui/state";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { LineChart } from "@/components/admin/LineChart";
import { DonutChart } from "@/components/admin/DonutChart";
import {
  useWaAnalyticsOverview, useWaMessageTrend, useWaStatusDistribution,
  useWaTypeDistribution, useWaTopContacts, useWaCampaignAnalytics,
  useWaAiUsage, useWaHourlyActivity,
} from "@/hooks/useWaAnalytics";
import {
  ANALYTICS_PERIOD_OPTIONS, MESSAGE_STATUS_LABELS, MESSAGE_STATUS_COLORS,
  MESSAGE_TYPE_LABELS, DAY_NAMES,
} from "@/types/wa-analytics.types";

export function WaAnalyticsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? "ar" : "en";
  const [period, setPeriod] = useState(30);

  const { data: overview, isLoading } = useWaAnalyticsOverview(period);
  const { data: trend } = useWaMessageTrend(period);
  const { data: statusDist } = useWaStatusDistribution(period);
  const { data: typeDist } = useWaTypeDistribution(period);
  const { data: topContacts } = useWaTopContacts(10, period);
  const { data: campaigns } = useWaCampaignAnalytics(10);
  const { data: aiUsage } = useWaAiUsage(period);
  const { data: hourly } = useWaHourlyActivity(7);

  if (isLoading) return <LoadingState className="min-h-[50vh]" />;

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      <PageHeader
        title={t("waAnalytics.title")}
        description={t("waAnalytics.description")}
        icon={BarChart3}
        action={
          <div className="w-40">
            <Select
              value={String(period)}
              onValueChange={(val) => setPeriod(Number(val))}
              options={ANALYTICS_PERIOD_OPTIONS.map((p) => ({
                value: String(p.value),
                label: p.label[locale],
              }))}
            />
          </div>
        }
      />

      {/* KPIs */}
      {overview && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label={t("waAnalytics.totalMessages")} value={overview.total_messages} icon={MessageSquare} accent="primary" />
            <StatCard label={t("waAnalytics.sent")} value={overview.sent_messages} icon={Send} accent="info" />
            <StatCard label={t("waAnalytics.received")} value={overview.received_messages} icon={Inbox} accent="success" />
            <StatCard label={t("waAnalytics.activeConversations")} value={overview.active_conversations} icon={Users} accent="warning" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label={t("waAnalytics.deliveryRate")} value={`${overview.delivery_rate.toFixed(1)}%`} icon={CheckCheck} accent="success" />
            <StatCard label={t("waAnalytics.readRate")} value={`${overview.read_rate.toFixed(1)}%`} icon={Eye} accent="primary" />
            <StatCard label={t("waAnalytics.failureRate")} value={`${overview.failure_rate.toFixed(1)}%`} icon={XCircle} accent="error" />
            <StatCard label={t("waAnalytics.newContacts")} value={overview.new_contacts_period} icon={TrendingUp} accent="info" />
          </div>
        </>
      )}

      {/* Trend Chart */}
      <Card hover="lift">
        <CardHeader>
          <CardTitle className="text-base">{t("waAnalytics.messageTrend")}</CardTitle>
        </CardHeader>
        <CardContent>
          {trend && trend.length > 0 ? (
            <LineChart data={trend.map((d) => ({ label: d.date, value: d.sent + d.received }))} height={240} />
          ) : (
            <EmptyState title={t("waAnalytics.noData")} />
          )}
        </CardContent>
      </Card>

      {/* Distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card hover="lift">
          <CardHeader><CardTitle className="text-base">{t("waAnalytics.statusDistribution")}</CardTitle></CardHeader>
          <CardContent>
            {statusDist && statusDist.length > 0 ? (
              <div className="flex flex-col items-center gap-4 sm:flex-row">
                <DonutChart
                  data={statusDist.map((s) => ({
                    label: MESSAGE_STATUS_LABELS[s.status]?.[locale] ?? s.status,
                    value: s.count,
                    color: MESSAGE_STATUS_COLORS[s.status] ?? "#9ca3af",
                  }))}
                  size={180}
                />
                <div className="space-y-1.5 flex-1 w-full">
                  {statusDist.map((s) => (
                    <div key={s.status} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: MESSAGE_STATUS_COLORS[s.status] ?? "#9ca3af" }} />
                        <span className="text-[var(--color-fg-muted)]">{MESSAGE_STATUS_LABELS[s.status]?.[locale] ?? s.status}</span>
                      </div>
                      <span className="font-semibold text-[var(--color-fg)]">{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <EmptyState title={t("waAnalytics.noData")} />}
          </CardContent>
        </Card>

        <Card hover="lift">
          <CardHeader><CardTitle className="text-base">{t("waAnalytics.typeDistribution")}</CardTitle></CardHeader>
          <CardContent>
            {typeDist && typeDist.length > 0 ? (
              <div className="space-y-2">
                {(() => {
                  const max = Math.max(...typeDist.map((t) => t.count));
                  return typeDist.map((item) => {
                    const pct = (item.count / max) * 100;
                    return (
                      <div key={item.type} className="flex items-center gap-3">
                        <div className="w-24 text-sm shrink-0 text-[var(--color-fg-muted)]">{MESSAGE_TYPE_LABELS[item.type]?.[locale] ?? item.type}</div>
                        <div className="flex-1 h-6 bg-[var(--color-surface-2)] rounded-md overflow-hidden">
                          <div className="h-full gradient-brand transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-sm font-semibold w-12 text-end text-[var(--color-fg)]">{item.count}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : <EmptyState title={t("waAnalytics.noData")} />}
          </CardContent>
        </Card>
      </div>

      {/* AI Usage */}
      {aiUsage && aiUsage.total_invocations > 0 && (
        <Card hover="lift">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bot size={18} />
              {t("waAnalytics.aiUsage")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <StatCard label={t("waAnalytics.aiInvocations")} value={aiUsage.total_invocations} icon={Bot} accent="primary" />
              <StatCard label={t("waAnalytics.aiCost")} value={`$${aiUsage.total_cost.toFixed(2)}`} icon={DollarSign} accent="success" />
              <StatCard label={t("waAnalytics.aiTokens")} value={aiUsage.total_tokens} icon={MessageSquare} accent="info" />
              <StatCard label={t("waAnalytics.aiEscalation")} value={`${aiUsage.total_invocations > 0 ? ((aiUsage.escalated / aiUsage.total_invocations) * 100).toFixed(1) : 0}%`} icon={TrendingUp} accent="warning" />
            </div>
            {aiUsage.by_model && aiUsage.by_model.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 text-[var(--color-fg)]">{t("waAnalytics.byModel")}</h4>
                <div className="space-y-2">
                  {aiUsage.by_model.map((m, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <code className="text-xs w-32 shrink-0 text-[var(--color-fg-muted)]">{m.model}</code>
                      <div className="flex-1 h-5 bg-[var(--color-surface-2)] rounded-md overflow-hidden">
                        <div className="h-full gradient-brand transition-all duration-500" style={{ width: `${(m.count / aiUsage.total_invocations) * 100}%` }} />
                      </div>
                      <span className="text-xs w-16 text-end text-[var(--color-fg)] font-medium">${m.cost.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Top Contacts */}
      <Card hover="lift">
        <CardHeader><CardTitle className="text-base">{t("waAnalytics.topContacts")}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!topContacts?.length ? (
            <div className="p-6"><EmptyState title={t("waAnalytics.noData")} /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("waAnalytics.contact")}</TableHead>
                  <TableHead className="text-end">{t("waAnalytics.messages")}</TableHead>
                  <TableHead className="text-end">{t("waAnalytics.inbound")}</TableHead>
                  <TableHead className="text-end">{t("waAnalytics.outbound")}</TableHead>
                  <TableHead>{t("waAnalytics.lastActivity")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topContacts.map((c) => (
                  <TableRow key={c.contact_id}>
                    <TableCell>
                      <div className="text-sm font-medium text-[var(--color-fg)]">{c.contact_name}</div>
                      <div className="text-xs text-[var(--color-fg-subtle)]">{c.contact_phone}</div>
                    </TableCell>
                    <TableCell className="text-end font-semibold text-[var(--color-fg)]">{c.messages_count}</TableCell>
                    <TableCell className="text-end text-sm text-[var(--color-fg-muted)]">{c.inbound_count}</TableCell>
                    <TableCell className="text-end text-sm text-[var(--color-fg-muted)]">{c.outbound_count}</TableCell>
                    <TableCell className="text-xs text-[var(--color-fg-subtle)] whitespace-nowrap">
                      {new Date(c.last_message_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Campaigns Performance */}
      <Card hover="lift">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Megaphone size={18} />
            {t("waAnalytics.campaignPerformance")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!campaigns?.length ? (
            <div className="p-6"><EmptyState title={t("waAnalytics.noCampaigns")} /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("waAnalytics.campaign")}</TableHead>
                  <TableHead>{t("waAnalytics.status")}</TableHead>
                  <TableHead className="text-end">{t("waAnalytics.recipients")}</TableHead>
                  <TableHead className="text-end">{t("waAnalytics.deliveryRate")}</TableHead>
                  <TableHead className="text-end">{t("waAnalytics.readRate")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((cmp) => (
                  <TableRow key={cmp.campaign_id}>
                    <TableCell className="text-sm font-medium text-[var(--color-fg)]">{cmp.campaign_name}</TableCell>
                    <TableCell><Badge variant="outline">{cmp.status}</Badge></TableCell>
                    <TableCell className="text-end text-[var(--color-fg-muted)]">{cmp.total_recipients}</TableCell>
                    <TableCell className="text-end">
                      <span className={cmp.delivery_rate >= 90 ? "text-[var(--color-success)] font-semibold" : cmp.delivery_rate >= 70 ? "text-[var(--color-warning)] font-semibold" : "text-[var(--color-error)] font-semibold"}>
                        {cmp.delivery_rate.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-end text-[var(--color-fg-muted)]">{cmp.read_rate.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Hourly Heatmap */}
      {hourly && hourly.length > 0 && (
        <Card hover="lift">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock size={18} />
              {t("waAnalytics.busyHours")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HourlyHeatmap data={hourly} locale={locale} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Hourly Heatmap Component ──────────────────────────────
function HourlyHeatmap({ data, locale }: { data: Array<{ day_of_week: number; hour: number; count: number }>; locale: string }) {
  const { t } = useTranslation();
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  const getColor = (count: number) => {
    if (count === 0) return "var(--color-surface-2)";
    const intensity = count / maxCount;
    return `rgba(109, 94, 252, ${0.15 + intensity * 0.85})`;
  };

  const getCell = (day: number, hour: number) => {
    return data.find((d) => d.day_of_week === day && d.hour === hour)?.count ?? 0;
  };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[700px]">
        {/* Hours header */}
        <div className="flex gap-1 mb-1">
          <div className="w-16 shrink-0" />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="flex-1 text-center text-xs text-[var(--color-fg-subtle)]">
              {h}
            </div>
          ))}
        </div>
        {/* Days rows */}
        {DAY_NAMES.map((day, dayIdx) => (
          <div key={dayIdx} className="flex gap-1 mb-1 items-center">
            <div className="w-16 shrink-0 text-xs text-[var(--color-fg-subtle)]">
              {day[locale as "en" | "ar"]}
            </div>
            {Array.from({ length: 24 }, (_, h) => {
              const count = getCell(dayIdx, h);
              return (
                <div
                  key={h}
                  className="flex-1 aspect-square min-h-[20px] rounded-sm cursor-default transition-transform hover:scale-125 hover:z-10 relative"
                  style={{ backgroundColor: getColor(count) }}
                  title={`${day[locale as "en" | "ar"]} ${h}:00 — ${count} ${t("waAnalytics.messages")}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
