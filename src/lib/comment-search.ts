// Pure helpers for the commenters table search / highlight.
// Extracted so we can unit-test filtering without mounting the route.

export type CommenterRow = {
  name?: string | null;
  commentText?: string | null;
};

/**
 * Case-insensitive substring search across the commenter's comment text and
 * display name. Whitespace-only queries return every row. Returned rows keep
 * their original order.
 */
export function filterCommenters<T extends CommenterRow>(rows: readonly T[], query: string): T[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return rows.slice();
  return rows.filter((r) => {
    const blob = `${r.commentText ?? ""} ${r.name ?? ""}`.toLowerCase();
    return blob.includes(q);
  });
}

/**
 * Splits `text` into segments around every case-insensitive occurrence of
 * `query`. Returned as `{ text, match }` tuples so the caller can render
 * matches with a `<mark>` element without dangerouslySetInnerHTML.
 * A blank query yields one non-match segment containing the full text.
 */
export function highlightSegments(
  text: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  const src = text ?? "";
  const q = (query ?? "").trim();
  if (!q) return [{ text: src, match: false }];
  const lower = src.toLowerCase();
  const needle = q.toLowerCase();
  const out: Array<{ text: string; match: boolean }> = [];
  let i = 0;
  while (i < src.length) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) {
      out.push({ text: src.slice(i), match: false });
      break;
    }
    if (idx > i) out.push({ text: src.slice(i, idx), match: false });
    out.push({ text: src.slice(idx, idx + needle.length), match: true });
    i = idx + needle.length;
  }
  return out;
}
