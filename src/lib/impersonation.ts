export const IMPERSONATION_BACKUP_KEY = "flowtix_admin_impersonation_backup";
export const IMPERSONATION_BACKUP_EVENT = "flowtix-impersonation-backup";

export type ImpersonationBackup = {
  access_token: string;
  refresh_token: string;
  admin_email: string;
  target_email: string;
  saved_at: number;
};

function notifyImpersonationBackupChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(IMPERSONATION_BACKUP_EVENT));
}

export function readImpersonationBackup(): ImpersonationBackup | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(IMPERSONATION_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ImpersonationBackup>;
    if (!parsed.access_token || !parsed.refresh_token || !parsed.admin_email || !parsed.target_email) return null;
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      admin_email: parsed.admin_email,
      target_email: parsed.target_email,
      saved_at: typeof parsed.saved_at === "number" ? parsed.saved_at : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveImpersonationBackup(backup: Omit<ImpersonationBackup, "saved_at">) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IMPERSONATION_BACKUP_KEY, JSON.stringify({ ...backup, saved_at: Date.now() }));
  } catch {
    // ignore
  }
  notifyImpersonationBackupChanged();
}

export function clearImpersonationBackup() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(IMPERSONATION_BACKUP_KEY);

    // Sweep any legacy / related impersonation entries from local + session storage
    const sweep = (storage: Storage) => {
      const toRemove: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key) continue;
        if (
          key === IMPERSONATION_BACKUP_KEY ||
          key.toLowerCase().includes("impersonat") ||
          key.startsWith("flowtix_admin_")
        ) {
          toRemove.push(key);
        }
      }
      for (const key of toRemove) storage.removeItem(key);
    };
    sweep(window.localStorage);
    sweep(window.sessionStorage);

    // Best-effort cookie sweep for anything impersonation-related
    const cookies = document.cookie ? document.cookie.split(";") : [];
    for (const raw of cookies) {
      const name = raw.split("=")[0]?.trim();
      if (!name) continue;
      if (name.toLowerCase().includes("impersonat") || name.startsWith("flowtix_admin_")) {
        const expire = "expires=Thu, 01 Jan 1970 00:00:00 GMT";
        document.cookie = `${name}=; ${expire}; path=/`;
        document.cookie = `${name}=; ${expire}; path=/; domain=${window.location.hostname}`;
      }
    }
  } catch {
    // ignore
  }
  notifyImpersonationBackupChanged();
}