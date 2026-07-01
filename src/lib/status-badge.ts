// Unified status badge tokens shared by WhatsApp Inbox, Facebook Campaigns,
// and Bulk Sender panels. Colors were tuned to pass WCAG AA (≥3.0 for large
// bold text) in both light and dark modes — see the badge audit under
// /tmp/browser/badges/. Never inline ad-hoc color classes for status chips;
// use `statusBadgeTone(status)` instead so all dashboards stay in sync.

export type StatusKind =
  | "running"
  | "pending"
  | "queued"
  | "paused"
  | "done"
  | "completed"
  | "error"
  | "failed"
  | "cancelled"
  | "idle"
  | "draft";

export interface StatusBadgeTone {
  /** Pill classes: background + text + ring, both light and dark. */
  tone: string;
  /** Solid color for progress bars / dots. */
  bar: string;
  /** Border-only variant (for cards / outlined chips). */
  border: string;
}

const RUNNING: StatusBadgeTone = {
  tone: "bg-primary/10 text-primary ring-1 ring-primary/30 dark:bg-primary/20 dark:text-primary-foreground",
  bar: "bg-primary",
  border: "border-primary/30",
};

const PENDING: StatusBadgeTone = {
  tone: "bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/30 dark:bg-amber-400/15 dark:text-amber-200",
  bar: "bg-amber-500",
  border: "border-amber-500/30",
};

const DONE: StatusBadgeTone = {
  tone: "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/30 dark:bg-emerald-400/15 dark:text-emerald-200",
  bar: "bg-emerald-500",
  border: "border-emerald-500/30",
};

const ERROR: StatusBadgeTone = {
  tone: "bg-destructive/10 text-destructive ring-1 ring-destructive/30 dark:bg-destructive/25 dark:text-red-200",
  bar: "bg-destructive",
  border: "border-destructive/30",
};

const NEUTRAL: StatusBadgeTone = {
  tone: "bg-muted/60 text-muted-foreground ring-1 ring-border dark:bg-muted/40 dark:text-muted-foreground",
  bar: "bg-muted-foreground/40",
  border: "border-border",
};

const MAP: Record<StatusKind, StatusBadgeTone> = {
  running: RUNNING,
  pending: PENDING,
  queued: PENDING,
  paused: PENDING,
  done: DONE,
  completed: DONE,
  error: ERROR,
  failed: ERROR,
  cancelled: NEUTRAL,
  idle: NEUTRAL,
  draft: NEUTRAL,
};

export function statusBadgeTone(status: string): StatusBadgeTone {
  return MAP[status as StatusKind] ?? NEUTRAL;
}
