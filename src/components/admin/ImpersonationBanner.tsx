import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { UserCheck, LogOut, Loader2, X } from "lucide-react";
import { toast } from "sonner";

const STORAGE_KEY = "flowtix_admin_impersonation_backup";

type Backup = {
  access_token: string;
  refresh_token: string;
  admin_email: string;
  target_email: string;
  saved_at: number;
};

export function saveAdminBackup(backup: Omit<Backup, "saved_at">) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...backup, saved_at: Date.now() }));
  } catch {
    // ignore
  }
}

export function ImpersonationBanner() {
  const [backup, setBackup] = useState<Backup | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [isArabic, setIsArabic] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsArabic(document.documentElement.dir === "rtl");
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setBackup(JSON.parse(raw));
    } catch {
      // ignore
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        try {
          setBackup(e.newValue ? JSON.parse(e.newValue) : null);
        } catch {
          setBackup(null);
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!backup) return null;

  const clearBackup = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setBackup(null);
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      await supabase.auth.signOut();
      const { error } = await supabase.auth.setSession({
        access_token: backup.access_token,
        refresh_token: backup.refresh_token,
      });
      // Always clear the stored backup — even on failure the tokens are
      // consumed/expired, so retrying keeps failing and the banner would
      // stay stuck. Better to force a clean sign-in.
      clearBackup();
      if (error) {
        toast.error(
          isArabic
            ? "انتهت جلسة الأدمن الأصلية، يرجى تسجيل الدخول مجدداً"
            : "Original admin session expired, please sign in again",
        );
        window.location.href = "/login";
        return;
      }
      toast.success(isArabic ? "تم الرجوع لحسابك" : "Restored to your account");
      window.location.href = "/admin/users";
    } catch (e) {
      clearBackup();
      toast.error((e as Error).message);
      window.location.href = "/login";
    }
  };

  return (
    <div
      dir={isArabic ? "rtl" : "ltr"}
      className="fixed top-0 inset-x-0 z-[100] bg-amber-500 text-amber-950 shadow-md"
      style={{ fontFamily: "'Cairo', 'Inter', sans-serif" }}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 px-4 py-2 text-xs sm:text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <UserCheck className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {isArabic
              ? `أنت تنتحل شخصية ${backup.target_email} — الأدمن الأصلي: ${backup.admin_email}`
              : `Impersonating ${backup.target_email} — original admin: ${backup.admin_email}`}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRestore}
            disabled={restoring}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-950 text-amber-50 px-3 py-1.5 text-xs font-semibold hover:bg-amber-900 disabled:opacity-50"
          >
            {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            {isArabic ? "رجوع للأدمن" : "Return to admin"}
          </button>
          <button
            onClick={clearBackup}
            aria-label={isArabic ? "إخفاء" : "Dismiss"}
            title={isArabic ? "إخفاء الشريط" : "Dismiss banner"}
            className="inline-flex items-center justify-center rounded-md bg-amber-950/10 text-amber-950 hover:bg-amber-950/20 h-7 w-7"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
