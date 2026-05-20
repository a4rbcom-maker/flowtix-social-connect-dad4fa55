import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  AlertCircle,
  Users,
  Eye,
  TrendingUp,
  Heart,
  UserPlus,
  UserMinus,
  Globe2,
  Clock3,
  RefreshCw,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Download, MessageCircle, ThumbsUp } from "lucide-react";
import { fetchFacebookPages, fetchPageInsights, fetchPageAudienceFromPosts } from "@/lib/facebook.functions";


export const Route = createFileRoute("/dashboard/facebook/insights")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.getSession();
  },
  component: InsightsPage,
});

type Page = { id: string; name: string; fan_count?: number; picture?: { data?: { url?: string } } };
type Insights = Awaited<ReturnType<typeof fetchPageInsights>>;
type Audience = Awaited<ReturnType<typeof fetchPageAudienceFromPosts>>;


const COUNTRY_NAMES_AR: Record<string, string> = {
  EG: "مصر", SA: "السعودية", AE: "الإمارات", US: "الولايات المتحدة", GB: "بريطانيا",
  DE: "ألمانيا", FR: "فرنسا", MA: "المغرب", DZ: "الجزائر", TN: "تونس", IQ: "العراق",
  JO: "الأردن", KW: "الكويت", QA: "قطر", LB: "لبنان", SY: "سوريا", YE: "اليمن",
  PS: "فلسطين", LY: "ليبيا", SD: "السودان", OM: "عمان", BH: "البحرين", TR: "تركيا",
};

function InsightsPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const listPagesFn = useServerFn(fetchFacebookPages);
  const fetchInsightsFn = useServerFn(fetchPageInsights);
  const fetchAudienceFn = useServerFn(fetchPageAudienceFromPosts);

  const [pages, setPages] = useState<Page[]>([]);
  const [pageId, setPageId] = useState<string>("");
  const [loadingPages, setLoadingPages] = useState(true);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [loadingAudience, setLoadingAudience] = useState(false);



  const t = ar
    ? {
        title: "تحليلات الصفحة",
        subtitle: "بيانات الصفحة التفصيلية: المعجبين، التفاعل اليومي، ديموغرافيا الجمهور، وأفضل أوقات النشاط",
        selectPage: "اختر الصفحة",
        noPages: "لا توجد صفحات. تأكد إنك ربطت حسابك وعندك صلاحية pages_show_list.",
        backToConnect: "→ صفحة الربط",
        loading: "جاري التحميل…",
        refresh: "تحديث",
        fans: "المعجبون",
        followers: "المتابعون",
        impressions: "مشاهدات",
        engagements: "تفاعل",
        reach: "وصول",
        views: "زيارات الصفحة",
        fanAdds: "إعجابات جديدة",
        fanRemoves: "إلغاء إعجاب",
        dailyEng: "النشاط اليومي (آخر 28 يوم)",
        dailyEngDesc: "مشاهدات + وصول + تفاعل + زيارات الصفحة",
        demographics: "ديموغرافيا الجمهور",
        genderAge: "الجنس والعمر",
        country: "أفضل 15 دولة",
        male: "ذكور",
        female: "إناث",
        bestHours: "أفضل أوقات النشاط",
        bestHoursDesc: "متوسط عدد المتابعين المتصلين بالساعة (آخر 7 أيام)",
        warningTitle: "تحذيرات",
        warningDesc: "بعض المقاييس مش متاحة (مهملة من Meta أو الصلاحيات ناقصة):",
        export: "تصدير CSV",
        genderTotal: "إجمالي الجنس",
        demoEmptyTitle: "البيانات الديموغرافية غير متاحة",
        demoEmptyBody:
          "Meta أهملت مقاييس عمر/جنس/دولة المعجبين لصفحات تجربة الصفحة الجديدة، وهتتشال نهائيًا في يونيو 2026. شوف قسم \"جمهور البوستات\" تحت كبديل عملي.",
        audienceTitle: "جمهور البوستات (بديل ديموغرافي)",
        audienceDesc:
          "أكتر ناس تفاعلت مع آخر بوستاتك — مستخرجة من التعليقات والإعجابات. ده المتاح حاليًا بدل ديموغرافيا المعجبين المهجورة.",
        topCommenters: "أكتر المعلقين",
        topReactors: "أكتر المتفاعلين",
        uniqueUsers: "أشخاص فريدون",
        totalComments: "تعليقات",
        totalReactions: "تفاعلات",
        postsScanned: "بوستات مفحوصة",
        loadAudience: "تحميل جمهور البوستات",
        loadingAudience: "بنحلل آخر البوستات…",
        count: "العدد",
      }
    : {
        title: "Page Insights",
        subtitle: "Page-level analytics: fans, daily engagement, audience demographics, and best activity times",
        selectPage: "Select page",
        noPages: "No pages found. Connect your account with pages_show_list scope.",
        backToConnect: "→ Connection page",
        loading: "Loading…",
        refresh: "Refresh",
        fans: "Fans",
        followers: "Followers",
        impressions: "Impressions",
        engagements: "Engagement",
        reach: "Reach",
        views: "Page views",
        fanAdds: "New likes",
        fanRemoves: "Unlikes",
        dailyEng: "Daily activity (last 28 days)",
        dailyEngDesc: "Impressions + reach + engagement + page views",
        demographics: "Audience demographics",
        genderAge: "Gender & age",
        country: "Top 15 countries",
        male: "Male",
        female: "Female",
        bestHours: "Best activity hours",
        bestHoursDesc: "Avg followers online per hour (last 7 days)",
        warningTitle: "Notes",
        warningDesc: "Some metrics are unavailable (deprecated by Meta or missing permission):",
        export: "Export CSV",
        genderTotal: "Gender split",
        demoEmptyTitle: "Demographics unavailable",
        demoEmptyBody:
          "Meta deprecated fan age/gender/country metrics for New Page Experience pages — full removal June 2026. See the Post Audience section below as a practical alternative.",
        audienceTitle: "Post audience (demographics alternative)",
        audienceDesc:
          "Real people who engaged with your recent posts — extracted from comments and reactions. This is what's actually available now in place of the deprecated fan demographics.",
        topCommenters: "Top commenters",
        topReactors: "Top reactors",
        uniqueUsers: "Unique people",
        totalComments: "Comments",
        totalReactions: "Reactions",
        postsScanned: "Posts scanned",
        loadAudience: "Load post audience",
        loadingAudience: "Analyzing recent posts…",
        count: "Count",

      };

  // Load pages once
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoadingPages(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await listPagesFn();
        if (cancelled) return;
        if (res.error) {
          setPagesError(res.error.message);
        } else {
          setPages(res.pages as Page[]);
          if (res.pages.length > 0) setPageId(String((res.pages[0] as Page).id));
        }
      } catch (e) {
        if (!cancelled) setPagesError(String(e));
      } finally {
        if (!cancelled) setLoadingPages(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, listPagesFn]);

  const loadInsights = async (id: string) => {
    if (!id) return;
    setLoadingInsights(true);
    setInsights(null);
    try {
      const res = await fetchInsightsFn({ data: { pageId: id } });
      setInsights(res);
      if (!res.ok) toast.error(res.error?.message ?? "Failed to load insights");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoadingInsights(false);
    }
  };

  const loadAudience = async (id: string) => {
    if (!id) return;
    setLoadingAudience(true);
    setAudience(null);
    try {
      const res = await fetchAudienceFn({ data: { pageId: id, postLimit: 25 } });
      setAudience(res);
      if (!res.ok) toast.error(res.error?.message ?? "Failed to load audience");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoadingAudience(false);
    }
  };

  // Auto-load when page changes
  useEffect(() => {
    if (pageId) void loadInsights(pageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);


  const genderAgeChart = useMemo(() => {
    if (!insights?.ok) return [];
    const buckets = new Map<string, { age: string; male: number; female: number }>();
    for (const r of insights.demographics.genderAge) {
      if (!r.age) continue;
      let b = buckets.get(r.age);
      if (!b) {
        b = { age: r.age, male: 0, female: 0 };
        buckets.set(r.age, b);
      }
      if (r.gender === "male") b.male += r.count;
      else if (r.gender === "female") b.female += r.count;
    }
    return Array.from(buckets.values()).sort((a, b) => a.age.localeCompare(b.age));
  }, [insights]);

  const countryChart = useMemo(() => {
    if (!insights?.ok) return [];
    return insights.demographics.country.map((c) => ({
      name: ar ? (COUNTRY_NAMES_AR[c.code] ?? c.code) : c.code,
      code: c.code,
      count: c.count,
    }));
  }, [insights, ar]);

  const genderTotal = useMemo(() => {
    const totals = { male: 0, female: 0 };
    for (const b of genderAgeChart) {
      totals.male += b.male;
      totals.female += b.female;
    }
    const sum = totals.male + totals.female;
    if (sum === 0) return [];
    return [
      { name: t.male, value: totals.male, pct: Math.round((totals.male / sum) * 100) },
      { name: t.female, value: totals.female, pct: Math.round((totals.female / sum) * 100) },
    ];
  }, [genderAgeChart, t.male, t.female]);

  const demoEmpty = genderAgeChart.length === 0 && countryChart.length === 0;


  // ── Render ───────────────────────────────────────────────────────────
  if (loadingPages) {
    return (
      <DashboardLayout title={t.title}>
        <div className="flex items-center justify-center p-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (pagesError || pages.length === 0) {
    return (
      <DashboardLayout title={t.title}>
        <Card className="p-10 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="mb-4 text-muted-foreground">{pagesError ?? t.noPages}</p>
          <Link to="/dashboard/facebook">
            <Button>{t.backToConnect}</Button>
          </Link>
        </Card>
      </DashboardLayout>
    );
  }

  const page = insights?.ok ? insights.page : null;

  return (
    <DashboardLayout title={t.title}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">{t.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadInsights(pageId)}
            disabled={loadingInsights || !pageId}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loadingInsights ? "animate-spin" : ""}`} />
            {t.refresh}
          </Button>
        </div>

        <Card className="p-4">
          <label className="mb-2 block text-sm font-medium">{t.selectPage}</label>
          <Select value={pageId} onValueChange={setPageId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pages.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Card>

        {loadingInsights && (
          <Card className="flex items-center justify-center p-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ms-3 text-sm text-muted-foreground">{t.loading}</span>
          </Card>
        )}

        {insights && !insights.ok && (
          <Card className="border-destructive/40 bg-destructive/5 p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
              <div>
                <p className="font-medium text-destructive">{insights.error?.message}</p>
              </div>
            </div>
          </Card>
        )}

        {insights?.ok && page && (
          <>
            {/* KPIs */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi icon={<Users className="h-5 w-5" />} label={t.fans} value={page.fan_count} />
              <Kpi icon={<UserPlus className="h-5 w-5" />} label={t.followers} value={page.followers_count} />
              <Kpi
                icon={<Eye className="h-5 w-5" />}
                label={t.impressions}
                value={sumField(insights.daily, "impressions")}
                hint={ar ? "آخر 28 يوم" : "Last 28 days"}
              />
              <Kpi
                icon={<Heart className="h-5 w-5" />}
                label={t.engagements}
                value={sumField(insights.daily, "engagements")}
                hint={ar ? "آخر 28 يوم" : "Last 28 days"}
              />
            </div>

            {/* Daily chart */}
            <Card className="p-5">
              <div className="mb-1 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">{t.dailyEng}</h3>
              </div>
              <p className="mb-4 text-xs text-muted-foreground">{t.dailyEngDesc}</p>
              <div className="h-72 w-full">
                <ResponsiveContainer>
                  <LineChart data={insights.daily}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" fontSize={11} tickFormatter={(d: string) => d.slice(5)} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="impressions" name={t.impressions} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="reach" name={t.reach} stroke="#06b6d4" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="engagements" name={t.engagements} stroke="#f97316" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="views" name={t.views} stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <MiniStat icon={<UserPlus className="h-4 w-4 text-green-600" />} label={t.fanAdds} value={sumField(insights.daily, "fanAdds")} />
                <MiniStat icon={<UserMinus className="h-4 w-4 text-red-600" />} label={t.fanRemoves} value={sumField(insights.daily, "fanRemoves")} />
                <MiniStat icon={<Eye className="h-4 w-4 text-primary" />} label={t.reach} value={sumField(insights.daily, "reach")} />
                <MiniStat icon={<TrendingUp className="h-4 w-4 text-primary" />} label={t.views} value={sumField(insights.daily, "views")} />
              </div>
            </Card>

            {/* Demographics */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{t.demographics}</h3>
              </div>
              {demoEmpty ? (
                <Card className="border-amber-300/50 bg-amber-50/50 p-6 dark:bg-amber-950/20">
                  <p className="mb-1 font-semibold">{t.demoEmptyTitle}</p>
                  <p className="text-sm text-muted-foreground">{t.demoEmptyBody}</p>
                </Card>
              ) : (
                <div className="grid gap-4 lg:grid-cols-3">
                  {/* Gender pie */}
                  <Card className="p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" />
                        <h3 className="font-semibold">{t.genderTotal}</h3>
                      </div>
                      {genderTotal.length > 0 && (
                        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => downloadCsv(`gender-total-${page.id}.csv`, genderTotal.map((g) => ({ name: g.name, value: g.value, pct: g.pct })))}>
                          <Download className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    {genderTotal.length === 0 ? (
                      <p className="text-sm text-muted-foreground">—</p>
                    ) : (
                      <div className="h-64 w-full">
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie data={genderTotal} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} label={(e: { pct: number; name: string }) => `${e.name} ${e.pct}%`}>
                              <Cell fill="#3b82f6" />
                              <Cell fill="#ec4899" />
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </Card>

                  {/* Gender × age bars */}
                  <Card className="p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" />
                        <h3 className="font-semibold">{t.genderAge}</h3>
                      </div>
                      {genderAgeChart.length > 0 && (
                        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => downloadCsv(`gender-age-${page.id}.csv`, genderAgeChart)}>
                          <Download className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    {genderAgeChart.length === 0 ? (
                      <p className="text-sm text-muted-foreground">—</p>
                    ) : (
                      <div className="h-64 w-full">
                        <ResponsiveContainer>
                          <BarChart data={genderAgeChart}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                            <XAxis dataKey="age" fontSize={11} />
                            <YAxis fontSize={11} />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="male" name={t.male} fill="#3b82f6" />
                            <Bar dataKey="female" name={t.female} fill="#ec4899" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </Card>

                  {/* Country */}
                  <Card className="p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Globe2 className="h-4 w-4 text-primary" />
                        <h3 className="font-semibold">{t.country}</h3>
                      </div>
                      {countryChart.length > 0 && (
                        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => downloadCsv(`countries-${page.id}.csv`, countryChart)}>
                          <Download className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    {countryChart.length === 0 ? (
                      <p className="text-sm text-muted-foreground">—</p>
                    ) : (
                      <div className="h-64 w-full">
                        <ResponsiveContainer>
                          <BarChart data={countryChart} layout="vertical" margin={{ left: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                            <XAxis type="number" fontSize={11} />
                            <YAxis dataKey="name" type="category" fontSize={11} width={80} />
                            <Tooltip />
                            <Bar dataKey="count" fill="hsl(var(--primary))">
                              {countryChart.map((_, i) => (
                                <Cell key={i} fill="hsl(var(--primary))" fillOpacity={1 - i * 0.05} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </Card>
                </div>
              )}
            </div>

            {/* Post audience — alternative when fan demographics are deprecated */}
            <Card className="p-5">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">{t.audienceTitle}</h3>
                </div>
                <div className="flex gap-2">
                  {audience?.ok && (audience.topCommenters.length > 0 || audience.topReactors.length > 0) && (
                    <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => downloadCsv(`post-audience-${page.id}.csv`, [...audience.topCommenters.map((c) => ({ type: "commenter", id: c.id, name: c.name, count: c.count })), ...audience.topReactors.map((r) => ({ type: "reactor", id: r.id, name: r.name, count: r.count }))])}>
                      <Download className="h-3 w-3" />
                      {t.export}
                    </Button>
                  )}
                  <Button size="sm" onClick={() => void loadAudience(pageId)} disabled={loadingAudience}>
                    {loadingAudience ? <Loader2 className="h-4 w-4 animate-spin" /> : t.loadAudience}
                  </Button>
                </div>
              </div>
              <p className="mb-4 text-xs text-muted-foreground">{t.audienceDesc}</p>

              {loadingAudience && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="ms-3 text-sm text-muted-foreground">{t.loadingAudience}</span>
                </div>
              )}

              {audience?.ok && !loadingAudience && (
                <>
                  <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <MiniStat icon={<Users className="h-4 w-4 text-primary" />} label={t.uniqueUsers} value={audience.totals.uniqueUsers} />
                    <MiniStat icon={<MessageCircle className="h-4 w-4 text-primary" />} label={t.totalComments} value={audience.totals.comments} />
                    <MiniStat icon={<ThumbsUp className="h-4 w-4 text-primary" />} label={t.totalReactions} value={audience.totals.reactions} />
                    <MiniStat icon={<TrendingUp className="h-4 w-4 text-primary" />} label={t.postsScanned} value={audience.totals.posts} />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <AudienceList title={t.topCommenters} items={audience.topCommenters} icon={<MessageCircle className="h-4 w-4" />} countLabel={t.count} />
                    <AudienceList title={t.topReactors} items={audience.topReactors} icon={<ThumbsUp className="h-4 w-4" />} countLabel={t.count} />
                  </div>
                </>
              )}
            </Card>



            {/* Best hours */}
            <Card className="p-5">
              <div className="mb-1 flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">{t.bestHours}</h3>
              </div>
              <p className="mb-4 text-xs text-muted-foreground">{t.bestHoursDesc}</p>
              {insights.onlineHourly.every((h) => h.avg === 0) ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <div className="h-56 w-full">
                  <ResponsiveContainer>
                    <BarChart data={insights.onlineHourly}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="hour" fontSize={11} tickFormatter={(h: number) => `${h}:00`} />
                      <YAxis fontSize={11} />
                      <Tooltip labelFormatter={(h) => `${h}:00`} />
                      <Bar dataKey="avg" name={ar ? "متصلون" : "Online"} fill="hsl(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {insights.warnings.length > 0 && (
              <Card className="border-amber-300/40 bg-amber-50/50 p-4 text-sm dark:bg-amber-950/20">
                <p className="mb-2 font-medium">{t.warningTitle}</p>
                <p className="mb-2 text-xs text-muted-foreground">{t.warningDesc}</p>
                <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                  {insights.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-semibold">{value.toLocaleString()}</div>
    </div>
  );
}

function sumField(rows: Array<Record<string, number | string>>, field: string): number {
  return rows.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
}

