import { describe, it, expect } from "vitest";
import { filterCommenters, highlightSegments } from "./comment-search";

const rows = [
  { name: "أحمد علي", commentText: "المنتج جميل جدًا وسعره مناسب" },
  { name: "Mona", commentText: "How much? DM me please" },
  { name: "Ahmed 2", commentText: "" },
  { name: "خالد", commentText: "السعر كام؟" },
  { name: null, commentText: null },
];

describe("filterCommenters", () => {
  it("returns all rows when query is empty or whitespace", () => {
    expect(filterCommenters(rows, "")).toHaveLength(rows.length);
    expect(filterCommenters(rows, "   ")).toHaveLength(rows.length);
  });

  it("matches Arabic text inside comment_text", () => {
    const res = filterCommenters(rows, "السعر");
    expect(res.map((r) => r.name)).toEqual(["خالد"]);
  });

  it("matches by name too, not just comment", () => {
    const res = filterCommenters(rows, "mona");
    expect(res).toHaveLength(1);
    expect(res[0].commentText).toContain("DM");
  });

  it("is case-insensitive for English", () => {
    expect(filterCommenters(rows, "HOW")).toHaveLength(1);
    expect(filterCommenters(rows, "how")).toHaveLength(1);
  });

  it("returns an empty array when nothing matches (no crash on null fields)", () => {
    expect(filterCommenters(rows, "zzznope")).toEqual([]);
  });

  it("preserves original row order", () => {
    const res = filterCommenters(rows, "e");
    // "Mona" (has 'e' via "please"), "Ahmed 2" have 'e' via English letters
    expect(res.map((r) => r.name)).toEqual(["Mona", "Ahmed 2"]);
  });
});

describe("highlightSegments", () => {
  it("wraps every case-insensitive match", () => {
    const segs = highlightSegments("Hello hello HELLO", "hello");
    expect(segs.filter((s) => s.match)).toHaveLength(3);
    // Reassembly matches original text exactly
    expect(segs.map((s) => s.text).join("")).toBe("Hello hello HELLO");
  });

  it("returns a single non-match segment when query is blank", () => {
    const segs = highlightSegments("anything", "");
    expect(segs).toEqual([{ text: "anything", match: false }]);
  });

  it("works with Arabic text", () => {
    const segs = highlightSegments("السعر كام يا فندم السعر", "السعر");
    expect(segs.filter((s) => s.match)).toHaveLength(2);
    expect(segs.map((s) => s.text).join("")).toBe("السعر كام يا فندم السعر");
  });

  it("handles a missing needle without duplicating text", () => {
    const segs = highlightSegments("nothing here", "xyz");
    expect(segs).toEqual([{ text: "nothing here", match: false }]);
  });
});
