export type Intent = "greeting" | "faq" | "sales" | "complaint" | "technical" | "other";

const DEFAULT_PATTERNS: { intent: Intent; words: string[] }[] = [
  { intent: "greeting", words: ["مرحبا","السلام عليكم","هاي","hello","hi","صباح","مساء"] },
  { intent: "faq", words: ["سعر","اسعار","كم","ميعاد","موعد","دوام","عنوان","كيف","متى"] },
  { intent: "sales", words: ["اشتري","شراء","باقة","اشتراك","عرض","discount","خصم"] },
  { intent: "complaint", words: ["شكوى","مشكلة","زعلان","سيء","غلط","احتيال","بطيء","لا يعمل","تعطل"] },
  { intent: "technical", words: ["خطأ","error","bug","كود","api","ربط","integration","تثبيت"] },
];

export function classifyIntent(text: string): { intent: Intent; confidence: number } {
  if (!text) return { intent: "other", confidence: 0.3 };
  const lower = text.toLowerCase();
  let best: { intent: Intent; score: number } = { intent: "other", score: 0 };
  for (const p of DEFAULT_PATTERNS) {
    const hits = p.words.filter((w) => lower.includes(w.toLowerCase())).length;
    if (hits > best.score) best = { intent: p.intent, score: hits };
  }
  const confidence = best.score === 0 ? 0.3 : best.score === 1 ? 0.6 : 0.85;
  return { intent: best.intent, confidence };
}

export function defaultLevelFor(intent: Intent): "l1" | "l2" | "l3" | "human" {
  switch (intent) {
    case "greeting": return "l1";
    case "faq": return "l1";
    case "sales": return "l2";
    case "technical": return "l3";
    case "complaint": return "l3";
    default: return "l2";
  }
}
