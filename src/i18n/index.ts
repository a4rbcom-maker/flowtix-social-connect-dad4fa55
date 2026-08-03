import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./locales/ar.json";
import en from "./locales/en.json";

export const languages = [
  { code: "ar", label: "العربية", dir: "rtl" as const },
  { code: "en", label: "English", dir: "ltr" as const },
];

export function getDir(code: string): "rtl" | "ltr" {
  return code === "ar" ? "rtl" : "ltr";
}

export function applyDocumentDir(code: string) {
  const dir = getDir(code);
  document.documentElement.lang = code;
  document.documentElement.dir = dir;
}

const storedLang = localStorage.getItem("flowtix_lang") || "ar";

i18n.use(initReactI18next).init({
  lng: storedLang,
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  fallbackLng: "ar",
  supportedLngs: ["ar", "en"],
  interpolation: { escapeValue: false },
}).then(() => {
  applyDocumentDir(storedLang);
});

export default i18n;
