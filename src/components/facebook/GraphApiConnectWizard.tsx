import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, ArrowRight, ArrowLeft, Check, ShieldCheck, Sparkles, Key, ExternalLink,
  Users, Layers, Eye, FileText, Copy, AlertTriangle, Lock,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

const SCOPES = [
  { key: "user_groups", icon: Users, ar: "user_groups", arDesc: "قراءة قائمة الجروبات التي أنت عضو فيها لاستيرادها تلقائيًا.", enDesc: "Read the list of groups you belong to so they can be auto-imported." },
  { key: "groups_access_member_info", icon: Lock, ar: "groups_access_member_info", arDesc: "الوصول لمعلومات أساسية عن الجروب (الاسم، الخصوصية، عدد الأعضاء).", enDesc: "Access basic group metadata (name, privacy, members count)." },
  { key: "pages_show_list", icon: Layers, ar: "pages_show_list", arDesc: "عرض قائمة الصفحات التي تديرها لاستخدامها لاحقًا.", enDesc: "List Pages you manage to use them later." },
  { key: "pages_read_engagement", icon: Eye, ar: "pages_read_engagement", arDesc: "قراءة بيانات التفاعل على صفحاتك (للإحصاءات والمنشورات).", enDesc: "Read engagement data from your Pages (insights, posts)." },
];

type Props = { open: boolean; onClose: () => void };

export function GraphApiConnectWizard({ open, onClose }: Props) {
  const { lang, dir } = useI18n();
  const [step, setStep] = useState(0);

  const t = lang === "ar" ? {
    title: "ربط Facebook Graph API",
    subtitle: "خطوة بخطوة — شرح كامل قبل البدء",
    steps: ["ما هو؟", "الصلاحيات المطلوبة", "احصل على Access Token", "اربط الحساب"],
    next: "التالي", back: "السابق", finish: "متابعة للربط", close: "إغلاق",
    s1Title: "ما هو Graph API ولماذا نحتاجه؟",
    s1Lead: "Graph API هو الواجهة الرسمية من Meta للتعامل مع بياناتك على فيسبوك. ربطه بـ Flowtix يفتح:",
    s1Bullets: [
      { icon: Users, title: "استيراد الجروبات تلقائيًا", desc: "لا حاجة لكتابة معرّفات الجروبات يدويًا — جروباتك تظهر مباشرة." },
      { icon: Layers, title: "إدارة الصفحات", desc: "اختيار صفحاتك واستخدامها في الحملات والردود الذكية." },
      { icon: FileText, title: "بيانات وإحصائيات حقيقية", desc: "أعداد الأعضاء، الخصوصية، صور الغلاف، ومؤشرات التفاعل." },
      { icon: ShieldCheck, title: "اتصال آمن ومعتمد رسميًا", desc: "Token يُخزَّن مشفّرًا — يمكنك إلغاء الربط في أي لحظة." },
    ],
    s1Note: "ملاحظة: الربط اختياري. يمكنك استخدام البوت ولصق معرّفات الجروبات يدويًا، لكن Graph API يجعل التجربة أسرع وأكثر دقة.",
    s2Title: "الصلاحيات (Scopes) المطلوبة",
    s2Lead: "هذه الصلاحيات فقط — بدون كتابة منشورات تلقائية أو أي صلاحيات حسّاسة:",
    s2WriteNote: "النشر داخل الجروبات يتم عبر بوت المتصفح (Bot)، لذلك لا نطلب صلاحية publish_to_groups المعطّلة من فيسبوك أصلاً.",
    s3Title: "كيف تحصل على Access Token؟",
    s3Steps: [
      "افتح Graph API Explorer من فيسبوك (الزر بالأسفل).",
      "من قائمة Meta App اختر تطبيقك أو استخدم \"Graph API Explorer\".",
      "اضغط \"Add a Permission\" وأضف الصلاحيات الأربع المذكورة في الخطوة السابقة.",
      "اضغط \"Generate Access Token\" ووافق على نافذة المنح.",
      "انسخ الـ Token الناتج واحتفظ به للخطوة التالية.",
    ],
    s3Tip: "نصيحة: استخدم Long-Lived Token (60 يوماً) من قسم Access Token Tool لو متاح.",
    s3Open: "افتح Graph API Explorer",
    s3Copy: "نسخ Scopes للحافظة",
    s3Copied: "تم نسخ الصلاحيات",
    s4Title: "جاهز للربط",
    s4Lead: "اضغط \"متابعة للربط\" للذهاب إلى صفحة فيسبوك ولصق الـ Token هناك.",
    s4Bullets: [
      "Token يُخزَّن في قاعدة بياناتك المحمية فقط.",
      "يمكنك إلغاء الربط أو إعادته في أي وقت.",
      "لن نشارك بياناتك مع أي طرف ثالث.",
    ],
  } : {
    title: "Connect Facebook Graph API",
    subtitle: "Step-by-step — full walkthrough before you start",
    steps: ["What is it?", "Required permissions", "Get an Access Token", "Connect"],
    next: "Next", back: "Back", finish: "Continue to connect", close: "Close",
    s1Title: "What is Graph API and why do we need it?",
    s1Lead: "Graph API is Meta's official interface to your Facebook data. Linking it to Flowtix unlocks:",
    s1Bullets: [
      { icon: Users, title: "Auto-import groups", desc: "No more pasting Group IDs — your groups appear instantly." },
      { icon: Layers, title: "Pages management", desc: "Pick the Pages you manage to use them in campaigns and AI replies." },
      { icon: FileText, title: "Real data & insights", desc: "Member counts, privacy, cover photos, and engagement metrics." },
      { icon: ShieldCheck, title: "Secure & official", desc: "Token is stored encrypted — you can revoke any time." },
    ],
    s1Note: "Note: Linking is optional. You can still use the bot and paste Group IDs manually — but Graph API makes things faster and more accurate.",
    s2Title: "Required permissions (scopes)",
    s2Lead: "These scopes only — no auto-publishing or sensitive permissions:",
    s2WriteNote: "Posting inside groups is performed via the browser Bot, so we don't request publish_to_groups (Facebook has deprecated it anyway).",
    s3Title: "How to get an Access Token",
    s3Steps: [
      "Open the Graph API Explorer (button below).",
      "Pick your app from the Meta App dropdown (or use \"Graph API Explorer\").",
      "Click \"Add a Permission\" and add the four scopes from the previous step.",
      "Click \"Generate Access Token\" and accept the consent dialog.",
      "Copy the generated token — you'll paste it in the next step.",
    ],
    s3Tip: "Tip: Use a Long-Lived Token (60 days) from the Access Token Tool if available.",
    s3Open: "Open Graph API Explorer",
    s3Copy: "Copy scopes to clipboard",
    s3Copied: "Scopes copied",
    s4Title: "Ready to connect",
    s4Lead: "Click \"Continue to connect\" to go to the Facebook page and paste your token there.",
    s4Bullets: [
      "Token is stored only in your secured database.",
      "You can revoke or reconnect at any time.",
      "We never share your data with any third party.",
    ],
  };

  const handleCopyScopes = async () => {
    try {
      await navigator.clipboard.writeText(SCOPES.map((s) => s.key).join(","));
      toast.success(t.s3Copied);
    } catch {
      toast.error(lang === "ar" ? "تعذّر النسخ" : "Copy failed");
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        dir={dir}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ type: "spring", damping: 24, stiffness: 280 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-3xl border border-border bg-card shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="relative px-6 pt-6 pb-4 border-b border-border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
            <button
              onClick={onClose}
              className="absolute top-4 end-4 p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition"
              aria-label={t.close}
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-primary/15 p-3">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold">{t.title}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{t.subtitle}</p>
              </div>
            </div>

            {/* Stepper */}
            <div className="mt-5 flex items-center gap-2">
              {t.steps.map((label, i) => (
                <div key={i} className="flex items-center gap-2 flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => i < step && setStep(i)}
                    disabled={i > step}
                    className={`flex items-center gap-2 min-w-0 ${i > step ? "cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <span className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                      i < step ? "bg-emerald-500 text-white" :
                      i === step ? "bg-primary text-primary-foreground ring-4 ring-primary/20" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span className={`text-xs font-semibold truncate hidden sm:inline ${i === step ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
                  </button>
                  {i < t.steps.length - 1 && <div className={`h-px flex-1 ${i < step ? "bg-emerald-500" : "bg-border"}`} />}
                </div>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: dir === "rtl" ? -20 : 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir === "rtl" ? 20 : -20 }}
                transition={{ duration: 0.2 }}
              >
                {step === 0 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-bold">{t.s1Title}</h3>
                    <p className="text-sm text-muted-foreground">{t.s1Lead}</p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {t.s1Bullets.map((b, i) => (
                        <div key={i} className="rounded-xl border border-border bg-background/60 p-4">
                          <div className="rounded-lg bg-primary/10 p-2 w-fit mb-2">
                            <b.icon className="h-4 w-4 text-primary" />
                          </div>
                          <div className="font-semibold text-sm">{b.title}</div>
                          <p className="text-xs text-muted-foreground mt-1">{b.desc}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{t.s1Note}</span>
                    </div>
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-bold">{t.s2Title}</h3>
                    <p className="text-sm text-muted-foreground">{t.s2Lead}</p>
                    <div className="space-y-2">
                      {SCOPES.map((s) => (
                        <div key={s.key} className="rounded-xl border border-border bg-background/60 p-4 flex items-start gap-3">
                          <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                            <s.icon className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <code className="text-xs font-mono font-bold text-foreground bg-primary/10 px-2 py-0.5 rounded">{s.key}</code>
                            <p className="text-xs text-muted-foreground mt-1.5">{lang === "ar" ? s.arDesc : s.enDesc}</p>
                          </div>
                          <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
                        </div>
                      ))}
                    </div>
                    <div className="flex items-start gap-2 rounded-xl bg-sky-500/10 border border-sky-500/30 p-3 text-xs text-sky-700 dark:text-sky-400">
                      <Lock className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{t.s2WriteNote}</span>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-bold">{t.s3Title}</h3>
                    <ol className="space-y-3">
                      {t.s3Steps.map((s, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="h-6 w-6 shrink-0 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                          <span className="text-sm text-foreground leading-relaxed">{s}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="rounded-xl bg-muted/50 border border-border p-3 text-xs text-muted-foreground">💡 {t.s3Tip}</div>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href="https://developers.facebook.com/tools/explorer/"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90"
                      >
                        <ExternalLink className="h-4 w-4" /> {t.s3Open}
                      </a>
                      <button
                        onClick={handleCopyScopes}
                        className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted"
                      >
                        <Copy className="h-4 w-4" /> {t.s3Copy}
                      </button>
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-4 text-center py-4">
                    <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
                      <Key className="h-8 w-8 text-emerald-500" />
                    </div>
                    <h3 className="text-lg font-bold">{t.s4Title}</h3>
                    <p className="text-sm text-muted-foreground">{t.s4Lead}</p>
                    <ul className="text-sm text-foreground text-start max-w-md mx-auto space-y-2">
                      {t.s4Bullets.map((b, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border bg-background/40 flex items-center justify-between gap-3">
            <button
              onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              {dir === "rtl" ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
              {step === 0 ? t.close : t.back}
            </button>
            {step < t.steps.length - 1 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold hover:opacity-90"
              >
                {t.next}
                {dir === "rtl" ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              </button>
            ) : (
              <Link
                to="/dashboard/facebook"
                onClick={onClose}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 text-white px-5 py-2 text-sm font-semibold hover:opacity-90"
              >
                <Check className="h-4 w-4" /> {t.finish}
              </Link>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
