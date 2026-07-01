import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/integrations/supabase/client";

/**
 * Syncs the current user's language + theme preferences with their profile row.
 *
 * - On sign-in: fetches saved `lang`/`theme` from `profiles` and applies them
 *   locally if they differ (so choices follow the user across devices).
 * - On toggle while signed in: writes the new value back to the profile.
 * - When signed out: falls back to the localStorage-based defaults handled by
 *   the I18nProvider / ThemeProvider (no writes performed).
 */
export function UserPreferencesSync() {
  const { user } = useAuth();
  const { lang, setLang } = useI18n();
  const { theme, toggleTheme, mounted } = useTheme();

  // Track whether we've already hydrated from the server for the current user
  // so the write-back effect doesn't fire during the initial pull.
  const hydratedForUser = useRef<string | null>(null);

  // Pull preferences from the profile when the user changes.
  useEffect(() => {
    if (!user) {
      hydratedForUser.current = null;
      return;
    }
    if (hydratedForUser.current === user.id) return;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("lang, theme")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled || error || !data) {
        hydratedForUser.current = user.id;
        return;
      }
      if (data.lang && (data.lang === "ar" || data.lang === "en") && data.lang !== lang) {
        setLang(data.lang);
      }
      if (
        data.theme &&
        (data.theme === "light" || data.theme === "dark") &&
        data.theme !== theme
      ) {
        toggleTheme();
      }
      hydratedForUser.current = user.id;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Push preferences back to the profile after the user is hydrated.
  useEffect(() => {
    if (!user || !mounted) return;
    if (hydratedForUser.current !== user.id) return;
    void supabase
      .from("profiles")
      .update({ lang, theme })
      .eq("id", user.id);
  }, [user, lang, theme, mounted]);

  return null;
}
