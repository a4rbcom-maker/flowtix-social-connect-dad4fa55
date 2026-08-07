import { useEffect } from "react";
import i18n, { applyDocumentDir } from "@/i18n";

export function LanguageSync() {
  useEffect(() => {
    applyDocumentDir(i18n.language || "ar");

    const handler = (lng: string) => applyDocumentDir(lng);
    i18n.on("languageChanged", handler);

    return () => {
      i18n.off("languageChanged", handler);
    };
  }, []);

  return null;
}
