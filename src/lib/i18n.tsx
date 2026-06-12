import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

type Lang = "ar" | "en";

const translations = {
  ar: {
    nav: {
      home: "الرئيسية",
      features: "المميزات",
      howItWorks: "كيف يعمل",
      pricing: "الأسعار",
      faq: "الأسئلة الشائعة",
      startFree: "تسجيل دخول",
      dashboard: "لوحة التحكم",
    },
    hero: {
      badge: "🚀 أقوى منصة للتجارة الاجتماعية",
      title1: "أدر أعمالك على",
      title2: "فيسبوك وواتساب",
      title3: "بذكاء وسهولة",
      desc: "أرسل لجروبات الفيسبوك، شغّل واتساب بوت بالذكاء الاصطناعي، وتابع عملاءك — كل ده من مكان واحد",
      cta: "تسجيل دخول",
      ctaSecondary: "اكتشف المميزات",
    },
    features: {
      title: "كل اللي محتاجه في مكان واحد",
      subtitle: "أدوات قوية لإدارة التجارة الاجتماعية بشكل احترافي",
      items: [
        { title: "إرسال لجروبات الفيسبوك", desc: "سجل دخولك بالتوكن وابعت رسالة لكل الجروبات اللي مشترك فيها بضغطة واحدة" },
        { title: "واتساب بوت ذكي", desc: "ربط واتساب عن طريق Meta API الرسمي أو سكان باركود — انت بتختار" },
        { title: "واتساب AI", desc: "خلّي الذكاء الاصطناعي يرد على عملاءك تلقائياً ويفهم نية الشراء" },
        { title: "إرسال جماعي بفاصل زمني", desc: "ابعت رسائل جماعية للواتساب مع تحكم كامل في الفاصل الزمني بين كل رسالة" },
        { title: "إرسال في الخلفية", desc: "ابدأ الإرسال وسيب الجهاز — الرسائل هتتبعت حتى لو قفلت المتصفح" },
        { title: "لوحة تحكم متقدمة", desc: "تابع كل حاجة — الرسائل، العملاء، الإحصائيات — من لوحة تحكم واحدة" },
      ],
    },
    howItWorks: {
      title: "كيف يعمل؟",
      subtitle: "3 خطوات بسيطة وهتبدأ",
      steps: [
        { title: "سجّل حسابك", desc: "أنشئ حساب جديد على المنصة في أقل من دقيقة" },
        { title: "اربط حساباتك", desc: "اربط فيسبوك بالتوكن أو واتساب بالباركود أو Meta API" },
        { title: "ابدأ الإرسال", desc: "ابعت رسائلك لكل جروباتك وعملاءك تلقائياً" },
      ],
    },
    pricing: {
      title: "باقات الأسعار",
      subtitle: "اختار الباقة المناسبة ليك",
      monthly: "شهرياً",
      popular: "الأكثر طلباً",
      cta: "ابدأ الآن",
      plans: [
        {
          name: "أساسي",
          price: "49",
          currency: "ج.م",
          features: ["إرسال لـ 10 جروبات فيسبوك", "واتساب بوت (باركود)", "100 رسالة يومياً", "دعم فني"],
        },
        {
          name: "احترافي",
          price: "149",
          currency: "ج.م",
          features: ["إرسال لجروبات غير محدودة", "واتساب بوت (Meta API + باركود)", "رسائل غير محدودة", "واتساب AI", "إرسال في الخلفية", "دعم أولوية"],
        },
        {
          name: "أعمال",
          price: "299",
          currency: "ج.م",
          features: ["كل مميزات الاحترافي", "حسابات متعددة", "API مخصص", "مدير حساب خاص", "تقارير متقدمة"],
        },
      ],
    },
    faq: {
      title: "الأسئلة الشائعة",
      items: [
        { q: "هل المنصة آمنة لحساباتي؟", a: "نعم، نحن نستخدم أحدث تقنيات التشفير والأمان لحماية بياناتك وحساباتك." },
        { q: "هل الإرسال بيشتغل في الخلفية فعلاً؟", a: "أيوه! بمجرد ما تبدأ الإرسال، السيرفر بيكمل حتى لو قفلت المتصفح أو الجهاز." },
        { q: "إيه الفرق بين Meta API والباركود؟", a: "Meta API هو الطريقة الرسمية ومحتاج حساب Business. الباركود أسهل في الإعداد لكنه غير رسمي." },
        { q: "أقدر أجرب المنصة قبل ما أدفع؟", a: "طبعاً! فيه فترة تجريبية مجانية على كل الباقات." },
      ],
    },
    footer: {
      desc: "أقوى منصة للتجارة الاجتماعية — إدارة فيسبوك وواتساب من مكان واحد",
      links: "روابط سريعة",
      contact: "تواصل معنا",
      rights: "جميع الحقوق محفوظة",
    },
  },
  en: {
    nav: {
      home: "Home",
      features: "Features",
      howItWorks: "How It Works",
      pricing: "Pricing",
      faq: "FAQ",
      startFree: "Start Free",
      dashboard: "Dashboard",
    },
    hero: {
      badge: "🚀 The Most Powerful Social Commerce Platform",
      title1: "Manage Your Business on",
      title2: "Facebook & WhatsApp",
      title3: "Smartly & Easily",
      desc: "Send to Facebook groups, run a WhatsApp AI bot, and follow up with your customers — all from one place",
      cta: "Start Free",
      ctaSecondary: "Discover Features",
    },
    features: {
      title: "Everything You Need in One Place",
      subtitle: "Powerful tools for professional social commerce management",
      items: [
        { title: "Facebook Group Messaging", desc: "Login with your token and send messages to all your groups with one click" },
        { title: "Smart WhatsApp Bot", desc: "Connect WhatsApp via official Meta API or QR code scan — you choose" },
        { title: "WhatsApp AI", desc: "Let AI automatically reply to your customers and understand purchase intent" },
        { title: "Bulk Messaging with Intervals", desc: "Send bulk WhatsApp messages with full control over time intervals between each message" },
        { title: "Background Sending", desc: "Start sending and leave your device — messages will be sent even if you close the browser" },
        { title: "Advanced Dashboard", desc: "Track everything — messages, customers, statistics — from a single dashboard" },
      ],
    },
    howItWorks: {
      title: "How It Works?",
      subtitle: "3 simple steps to get started",
      steps: [
        { title: "Create Account", desc: "Sign up on the platform in less than a minute" },
        { title: "Connect Accounts", desc: "Link Facebook with token or WhatsApp via QR code or Meta API" },
        { title: "Start Sending", desc: "Send messages to all your groups and customers automatically" },
      ],
    },
    pricing: {
      title: "Pricing Plans",
      subtitle: "Choose the plan that fits you",
      monthly: "/month",
      popular: "Most Popular",
      cta: "Get Started",
      plans: [
        {
          name: "Basic",
          price: "49",
          currency: "EGP",
          features: ["Send to 10 Facebook groups", "WhatsApp Bot (QR Code)", "100 messages/day", "Tech support"],
        },
        {
          name: "Professional",
          price: "149",
          currency: "EGP",
          features: ["Unlimited Facebook groups", "WhatsApp Bot (Meta API + QR)", "Unlimited messages", "WhatsApp AI", "Background sending", "Priority support"],
        },
        {
          name: "Business",
          price: "299",
          currency: "EGP",
          features: ["All Professional features", "Multiple accounts", "Custom API", "Dedicated account manager", "Advanced reports"],
        },
      ],
    },
    faq: {
      title: "Frequently Asked Questions",
      items: [
        { q: "Is the platform safe for my accounts?", a: "Yes, we use the latest encryption and security technologies to protect your data and accounts." },
        { q: "Does background sending really work?", a: "Yes! Once you start sending, the server continues even if you close the browser or device." },
        { q: "What's the difference between Meta API and QR Code?", a: "Meta API is the official method requiring a Business account. QR code is easier to set up but unofficial." },
        { q: "Can I try the platform before paying?", a: "Of course! There's a free trial on all plans." },
      ],
    },
    footer: {
      desc: "The most powerful social commerce platform — manage Facebook & WhatsApp from one place",
      links: "Quick Links",
      contact: "Contact Us",
      rights: "All rights reserved",
    },
  },
} as const;

type Translations = (typeof translations)[Lang];

interface I18nContextType {
  lang: Lang;
  t: Translations;
  setLang: (lang: Lang) => void;
  dir: "rtl" | "ltr";
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("flowtix-lang") as Lang) || "ar";
    }
    return "ar";
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") {
      localStorage.setItem("flowtix-lang", l);
    }
  }, []);

  const dir = lang === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
      document.documentElement.dir = dir;
    }
  }, [lang, dir]);

  const value: I18nContextType = {
    lang,
    t: translations[lang],
    setLang,
    dir,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
