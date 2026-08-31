/**
 * Managed-pages entity filter (Task 2).
 *
 * Single source of truth for "does this entity count as a managed page?"
 * Used by /list-pages (GraphQL switcher interception + DOM fallback).
 * Pure functions only — covered by src/routes/__tests__/managed-pages-filter.test.ts.
 */

export interface ManagedPageCandidate {
  id: string;
  name: string;
  pictureUrl?: string;
  username?: string;
}

/** Names that are UI counters/labels, never real page names (probe 2026-08-31). */
const COUNTER_NAME_PATTERNS: RegExp[] = [
  /عدد\s*الإشعارات/i,
  /غير\s*الم?قروء/i,
  /^\d+\s*إشعار/,
  /^\d+\s*رسال/,
  /^\d+\s*notification/i,
  /^\d+\s*unread/i,
  /^\d+\s*new\s*message/i,
  /^notifications?$/i,
  /^الإشعارات?$/,
  /^الرسائل?$/,
];

/** A name must look like a real page name: letters, 2..80 chars, not a counter. */
export function isRealPageName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return false;
  if (/^\d+$/.test(trimmed)) return false; // bare number
  if (COUNTER_NAME_PATTERNS.some(p => p.test(trimmed))) return false; // counter copy
  return true;
}

/**
 * GraphQL switcher entity gate: numeric id + Page typename + real name +
 * working publishing authorization.
 */
export function isManagedPageEntity(entity: unknown): boolean {
  if (!entity || typeof entity !== "object") return false;
  const e = entity as Record<string, unknown>;
  const id = e.id != null ? String(e.id) : "";
  if (!/^\d{5,}$/.test(id)) return false;
  if (e.__typename !== "Page") return false;
  if (!isRealPageName(e.name)) return false;
  if (e.is_failing_page_publishing_authorization === true) return false;
  return true;
}

/**
 * DOM fallback gate: same numeric-id + name rules, no __typename available.
 */
export function isManagedPageCandidate(id: unknown, name: unknown): boolean {
  const idStr = id != null ? String(id) : "";
  if (!/^\d{5,}$/.test(idStr)) return false;
  return isRealPageName(name);
}

/** Deep-walk any parsed JSON and collect valid managed pages (deduped by id). */
export function extractManagedPages(root: unknown): ManagedPageCandidate[] {
  const byId = new Map<string, ManagedPageCandidate>();

  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 25) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (isManagedPageEntity(node)) {
      const e = node as Record<string, unknown>;
      const id = String(e.id);
      if (!byId.has(id)) {
        const pic = e.profile_picture as { uri?: string } | undefined;
        byId.set(id, {
          id,
          name: String(e.name).trim(),
          pictureUrl: pic?.uri || "",
        });
      }
      return; // pages don't nest further pages
    }
    for (const val of Object.values(node as Record<string, unknown>)) {
      if (val && typeof val === "object") walk(val, depth + 1);
    }
  };

  walk(root, 0);
  return Array.from(byId.values());
}
