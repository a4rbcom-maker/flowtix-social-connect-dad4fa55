import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CheckCircle2, AlertTriangle, Info, XCircle, ChevronLeft, ChevronRight, Search, Filter, Download } from "lucide-react";

export const Route = createFileRoute("/dashboard/rtl-test")({
  head: () => ({
    meta: [{ title: "اختبار RTL — Flowtix" }],
  }),
  component: RtlTestPage,
});

type Lang = "ar" | "en";

function RtlTestPage() {
  const [lang, setLang] = useState<Lang>("ar");
  const dir = lang === "ar" ? "rtl" : "ltr";
  const t = lang === "ar" ? AR : EN;

  return (
    <div dir={dir} className="container mx-auto space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold md:text-3xl">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-lg border bg-card p-1">
          <Button size="sm" variant={lang === "ar" ? "default" : "ghost"} onClick={() => setLang("ar")}>العربية</Button>
          <Button size="sm" variant={lang === "en" ? "default" : "ghost"} onClick={() => setLang("en")}>English</Button>
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{t.alertTitle}</AlertTitle>
        <AlertDescription>{t.alertDesc}</AlertDescription>
      </Alert>

      <Tabs defaultValue="forms" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="forms">{t.tabs.forms}</TabsTrigger>
          <TabsTrigger value="tables">{t.tabs.tables}</TabsTrigger>
          <TabsTrigger value="badges">{t.tabs.badges}</TabsTrigger>
          <TabsTrigger value="dialogs">{t.tabs.dialogs}</TabsTrigger>
        </TabsList>

        {/* FORMS */}
        <TabsContent value="forms" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t.forms.title}</CardTitle>
              <CardDescription>{t.forms.desc}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">{t.forms.name}</Label>
                <Input id="name" placeholder={t.forms.namePh} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t.forms.email}</Label>
                <Input id="email" type="email" placeholder="name@example.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">{t.forms.phone}</Label>
                <Input id="phone" type="tel" placeholder="+20 100 000 0000" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="age">{t.forms.age}</Label>
                <Input id="age" type="number" placeholder="25" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="search">{t.forms.search}</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground start-3" />
                  <Input id="search" placeholder={t.forms.searchPh} className="ps-9" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">{t.forms.city}</Label>
                <Select>
                  <SelectTrigger id="city"><SelectValue placeholder={t.forms.cityPh} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cai">{t.cities.cai}</SelectItem>
                    <SelectItem value="alx">{t.cities.alx}</SelectItem>
                    <SelectItem value="giz">{t.cities.giz}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="notes">{t.forms.notes}</Label>
                <Textarea id="notes" placeholder={t.forms.notesPh} rows={4} />
              </div>
              <div className="space-y-3">
                <Label>{t.forms.gender}</Label>
                <RadioGroup defaultValue="m" className="flex gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <RadioGroupItem value="m" id="m" /> <span>{t.forms.male}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <RadioGroupItem value="f" id="f" /> <span>{t.forms.female}</span>
                  </label>
                </RadioGroup>
              </div>
              <div className="space-y-3">
                <Label>{t.forms.prefs}</Label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox defaultChecked /> <span>{t.forms.newsletter}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Switch defaultChecked /> <span>{t.forms.notify}</span>
                  </label>
                </div>
              </div>
              <div className="space-y-3 md:col-span-2">
                <Label>{t.forms.budget}</Label>
                <Slider defaultValue={[40]} max={100} step={1} />
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button>{t.forms.save}</Button>
            <Button variant="secondary">{t.forms.draft}</Button>
            <Button variant="outline" className="gap-2">
              <Download className="h-4 w-4" /> {t.forms.export}
            </Button>
            <Button variant="ghost" className="gap-2">
              <Filter className="h-4 w-4" /> {t.forms.filter}
            </Button>
            <Button variant="destructive">{t.forms.cancel}</Button>
          </div>
        </TabsContent>

        {/* TABLES */}
        <TabsContent value="tables" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t.tables.title}</CardTitle>
              <CardDescription>{t.tables.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.tables.id}</TableHead>
                      <TableHead>{t.tables.name}</TableHead>
                      <TableHead>{t.tables.city}</TableHead>
                      <TableHead>{t.tables.amount}</TableHead>
                      <TableHead>{t.tables.status}</TableHead>
                      <TableHead className="text-end">{t.tables.actions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {SAMPLE.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono">{r.id}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-7 w-7"><AvatarFallback>{r.name[0]}</AvatarFallback></Avatar>
                            <span className="truncate">{lang === "ar" ? r.name : r.nameEn}</span>
                          </div>
                        </TableCell>
                        <TableCell>{lang === "ar" ? r.city : r.cityEn}</TableCell>
                        <TableCell className="tabular-nums">{r.amount.toLocaleString(lang === "ar" ? "ar-EG" : "en-US")} {lang === "ar" ? "ج.م" : "EGP"}</TableCell>
                        <TableCell><StatusBadge status={r.status} lang={lang} /></TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost"><ChevronRight className="h-4 w-4 rtl:hidden" /><ChevronLeft className="h-4 w-4 ltr:hidden" /></Button>
                            <Button size="sm" variant="outline">{t.tables.view}</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* BADGES & PROGRESS */}
        <TabsContent value="badges" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t.badges.title}</CardTitle>
              <CardDescription>{t.badges.desc}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-wrap gap-2">
                <Badge><CheckCircle2 className="me-1 h-3 w-3" />{t.status.success}</Badge>
                <Badge variant="secondary"><Info className="me-1 h-3 w-3" />{t.status.info}</Badge>
                <Badge variant="destructive"><XCircle className="me-1 h-3 w-3" />{t.status.failed}</Badge>
                <Badge variant="outline"><AlertTriangle className="me-1 h-3 w-3" />{t.status.warn}</Badge>
                <Badge className="bg-amber-500 text-white">{t.status.pending}</Badge>
                <Badge className="bg-blue-600 text-white">{t.status.running}</Badge>
              </div>
              <Separator />
              <div className="space-y-3">
                {[25, 60, 92].map((v) => (
                  <div key={v} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>{t.badges.task} #{v}</span>
                      <span className="tabular-nums text-muted-foreground">{v}%</span>
                    </div>
                    <Progress value={v} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            {[
              { t: t.alerts.success, d: t.alerts.successD, Icon: CheckCircle2, cls: "border-emerald-500/50" },
              { t: t.alerts.warn, d: t.alerts.warnD, Icon: AlertTriangle, cls: "border-amber-500/50" },
              { t: t.alerts.error, d: t.alerts.errorD, Icon: XCircle, cls: "border-destructive/50" },
            ].map((a, i) => (
              <Alert key={i} className={a.cls}>
                <a.Icon className="h-4 w-4" />
                <AlertTitle>{a.t}</AlertTitle>
                <AlertDescription>{a.d}</AlertDescription>
              </Alert>
            ))}
          </div>
        </TabsContent>

        {/* DIALOGS */}
        <TabsContent value="dialogs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t.dialogs.title}</CardTitle>
              <CardDescription>{t.dialogs.desc}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Dialog>
                <DialogTrigger asChild><Button>{t.dialogs.open}</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t.dialogs.heading}</DialogTitle>
                    <DialogDescription>{t.dialogs.body}</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label>{t.forms.name}</Label>
                    <Input placeholder={t.forms.namePh} />
                  </div>
                  <DialogFooter>
                    <Button variant="outline">{t.forms.cancel}</Button>
                    <Button>{t.forms.save}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusBadge({ status, lang }: { status: SampleStatus; lang: Lang }) {
  const map = {
    completed: { cls: "bg-emerald-500 text-white", ar: "مكتمل", en: "Completed" },
    running:   { cls: "bg-blue-600 text-white",    ar: "قيد التشغيل", en: "Running" },
    pending:   { cls: "bg-amber-500 text-white",   ar: "معلق", en: "Pending" },
    failed:    { cls: "bg-destructive text-white", ar: "فشل", en: "Failed" },
  } as const;
  const m = map[status];
  return <Badge className={m.cls}>{lang === "ar" ? m.ar : m.en}</Badge>;
}

type SampleStatus = "completed" | "running" | "pending" | "failed";
const SAMPLE: { id: string; name: string; nameEn: string; city: string; cityEn: string; amount: number; status: SampleStatus }[] = [
  { id: "#1024", name: "أحمد محمد", nameEn: "Ahmed Mohamed", city: "القاهرة", cityEn: "Cairo", amount: 1250, status: "completed" },
  { id: "#1025", name: "سارة علي",  nameEn: "Sara Ali",      city: "الإسكندرية", cityEn: "Alexandria", amount: 480,  status: "running" },
  { id: "#1026", name: "محمود حسن", nameEn: "Mahmoud Hassan", city: "الجيزة", cityEn: "Giza", amount: 3200, status: "pending" },
  { id: "#1027", name: "ليلى إبراهيم", nameEn: "Layla Ibrahim", city: "المنصورة", cityEn: "Mansoura", amount: 0,    status: "failed" },
];

const AR = {
  title: "اختبار RTL — عرض المكوّنات",
  subtitle: "صفحة فحص لمحاذاة النماذج والجداول والشارات والـ Dialogs.",
  alertTitle: "تنبيه",
  alertDesc: "بدّل اللغة من الأعلى لرؤية التحوّل الفوري بين RTL و LTR والتحقق من عدم تفكك أي عنصر.",
  tabs: { forms: "نماذج", tables: "جداول", badges: "شارات وتقدم", dialogs: "نوافذ" },
  forms: {
    title: "حقول الإدخال", desc: "تحقق أن النصوص والـ Placeholders والأيقونات تنحاز لليمين تلقائياً.",
    name: "الاسم", namePh: "اكتب اسمك الكامل", email: "البريد الإلكتروني", phone: "رقم الهاتف",
    age: "العمر", search: "بحث", searchPh: "ابحث عن أي شيء…", city: "المدينة", cityPh: "اختر المدينة",
    notes: "ملاحظات", notesPh: "اكتب ملاحظاتك هنا…", gender: "النوع", male: "ذكر", female: "أنثى",
    prefs: "التفضيلات", newsletter: "اشتراك في النشرة", notify: "تفعيل التنبيهات", budget: "الميزانية",
    save: "حفظ", draft: "حفظ كمسودّة", export: "تصدير", filter: "تصفية", cancel: "إلغاء",
  },
  cities: { cai: "القاهرة", alx: "الإسكندرية", giz: "الجيزة" },
  tables: { title: "جدول البيانات", desc: "تأكد من أن أزرار الإجراءات على الجهة الصحيحة وأن الأرقام لا تنعكس.",
    id: "الكود", name: "الاسم", city: "المدينة", amount: "المبلغ", status: "الحالة", actions: "إجراءات", view: "عرض" },
  badges: { title: "الشارات وأشرطة التقدم", desc: "ألوان وحالات قياسية.", task: "مهمة" },
  status: { success: "ناجح", info: "معلومة", failed: "فشل", warn: "تحذير", pending: "معلق", running: "قيد التشغيل" },
  alerts: {
    success: "تمت العملية", successD: "تم حفظ التغييرات بنجاح.",
    warn: "انتبه", warnD: "بعض الحقول قد تحتاج مراجعة قبل المتابعة.",
    error: "حدث خطأ", errorD: "فشل الاتصال بالخادم، حاول مرة أخرى.",
  },
  dialogs: { title: "النوافذ المنبثقة", desc: "افتح النافذة وتحقق من اتجاه المحتوى والأزرار.",
    open: "افتح نافذة", heading: "تعديل البيانات", body: "هذه نافذة اختبار لتأكيد محاذاة العناصر داخلها." },
};

const EN: typeof AR = {
  title: "RTL Test — Components Showcase",
  subtitle: "Inspect alignment of forms, tables, badges and dialogs.",
  alertTitle: "Heads up",
  alertDesc: "Switch language above to verify a clean flip between RTL and LTR with no broken alignment.",
  tabs: { forms: "Forms", tables: "Tables", badges: "Badges & Progress", dialogs: "Dialogs" },
  forms: {
    title: "Form Fields", desc: "Confirm text, placeholders and icons align correctly.",
    name: "Name", namePh: "Enter your full name", email: "Email", phone: "Phone",
    age: "Age", search: "Search", searchPh: "Search anything…", city: "City", cityPh: "Pick a city",
    notes: "Notes", notesPh: "Write your notes here…", gender: "Gender", male: "Male", female: "Female",
    prefs: "Preferences", newsletter: "Subscribe to newsletter", notify: "Enable notifications", budget: "Budget",
    save: "Save", draft: "Save draft", export: "Export", filter: "Filter", cancel: "Cancel",
  },
  cities: { cai: "Cairo", alx: "Alexandria", giz: "Giza" },
  tables: { title: "Data Table", desc: "Verify action buttons sit on the correct side and numbers don't flip.",
    id: "ID", name: "Name", city: "City", amount: "Amount", status: "Status", actions: "Actions", view: "View" },
  badges: { title: "Badges & Progress", desc: "Standard colors and states.", task: "Task" },
  status: { success: "Success", info: "Info", failed: "Failed", warn: "Warning", pending: "Pending", running: "Running" },
  alerts: {
    success: "Done", successD: "Your changes have been saved successfully.",
    warn: "Heads up", warnD: "Some fields may need review before continuing.",
    error: "Error", errorD: "Could not reach the server, please try again.",
  },
  dialogs: { title: "Dialogs", desc: "Open the dialog and confirm content + button direction.",
    open: "Open dialog", heading: "Edit data", body: "This is a test dialog to confirm element alignment inside it." },
};
