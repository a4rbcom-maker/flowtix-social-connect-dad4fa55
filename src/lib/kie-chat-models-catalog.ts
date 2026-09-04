// Catalog رسمي لموديلات الـ Chat في Kie.ai
// المصدر: https://docs.kie.ai (قسم Chat Models)
// يُستخدم كقائمة منسدلة في لوحة تحكم السالكي — لا يوجد endpoint API عام في Kie.ai لجلب قائمة الموديلات

export interface KieChatModel {
  /** الـ model_id الفعلي المُرسل لـ Kie API (مثل: "gemini-3.1-pro") */
  model_id: string;
  /** اسم العرض بالإنجليزية */
  display_name_en: string;
  /** اسم العرض بالعربية */
  display_name_ar: string;
  /** وصف مختصر بالإنجليزية */
  desc_en: string;
  /** وصف مختصر بالعربية */
  desc_ar: string;
  /** العائلة (gpt / claude / gemini / grok) */
  family: "gpt" | "claude" | "gemini" | "grok";
  /** موديل متقدم (Premium فقط) */
  is_premium?: boolean;
}

/**
 * عند إضافة موديل جديد لـ Kie.ai من الـ docs، أضفه هنا.
 * الترتيب داخل كل عائلة = من الأحدث للأقدم.
 */
export const KIE_CHAT_MODELS: KieChatModel[] = [
  // ─── Claude ───
  { model_id: "claude-opus-4.7", family: "claude", display_name_en: "Claude Opus 4.7", display_name_ar: "كلود أوبس 4.7", desc_en: "Anthropic's most capable Claude", desc_ar: "أقوى موديلات Anthropic", is_premium: true },
  { model_id: "claude-opus-4.8", family: "claude", display_name_en: "Claude Opus 4.8", display_name_ar: "كلود أوبس 4.8", desc_en: "Anthropic's flagship reasoning model", desc_ar: "موديل الاستدلال الرائد من Anthropic", is_premium: true },
  { model_id: "claude-fable-5", family: "claude", display_name_en: "Claude Fable 5", display_name_ar: "كلود فابل 5", desc_en: "Anthropic's creative writing model", desc_ar: "موديل الكتابة الإبداعية من Anthropic" },
  { model_id: "claude-sonnet-5", family: "claude", display_name_en: "Claude Sonnet 5", display_name_ar: "كلود سونيت 5", desc_en: "Anthropic's balanced Claude", desc_ar: "كلود المتوازن من Anthropic" },
  { model_id: "claude-haiku-4.5", family: "claude", display_name_en: "Claude Haiku 4.5", display_name_ar: "كلود هايكو 4.5", desc_en: "Fast & economical", desc_ar: "سريع واقتصادي" },
  { model_id: "claude-opus-4.5", family: "claude", display_name_en: "Claude Opus 4.5", display_name_ar: "كلود أوبس 4.5", desc_en: "Anthropic's flagship Claude", desc_ar: "الرائد من Anthropic", is_premium: true },
  { model_id: "claude-opus-4.6", family: "claude", display_name_en: "Claude Opus 4.6", display_name_ar: "كلود أوبس 4.6", desc_en: "Anthropic's flagship Claude", desc_ar: "الرائد من Anthropic", is_premium: true },
  { model_id: "claude-opus-5", family: "claude", display_name_en: "Claude Opus 5", display_name_ar: "كلود أوبس 5", desc_en: "Next-gen Anthropic flagship", desc_ar: "الجيل القادم من Anthropic", is_premium: true },
  { model_id: "claude-sonnet-4.5", family: "claude", display_name_en: "Claude Sonnet 4.5", display_name_ar: "كلود سونيت 4.5", desc_en: "Anthropic's balanced Claude", desc_ar: "كلود المتوازن من Anthropic" },
  { model_id: "claude-sonnet-4.6", family: "claude", display_name_en: "Claude Sonnet 4.6", display_name_ar: "كلود سونيت 4.6", desc_en: "Anthropic's balanced Claude", desc_ar: "كلود المتوازن من Anthropic" },

  // ─── GPT ───
  { model_id: "gpt-5.2", family: "gpt", display_name_en: "GPT 5.2", display_name_ar: "جي بي تي 5.2", desc_en: "OpenAI's flagship", desc_ar: "الرائد من OpenAI", is_premium: true },
  { model_id: "gpt-5.6-luna", family: "gpt", display_name_en: "GPT 5.6 Luna", display_name_ar: "جي بي تي 5.6 لونا", desc_en: "OpenAI's flagship (Luna variant)", desc_ar: "الرائد من OpenAI (نسخة لونا)", is_premium: true },
  { model_id: "gpt-5.6-terra", family: "gpt", display_name_en: "GPT 5.6 Terra", display_name_ar: "جي بي تي 5.6 تيرا", desc_en: "OpenAI's flagship (Terra variant)", desc_ar: "الرائد من OpenAI (نسخة تيرا)", is_premium: true },
  { model_id: "gpt-5.6-sol", family: "gpt", display_name_en: "GPT 5.6 Sol", display_name_ar: "جي بي تي 5.6 سول", desc_en: "OpenAI's flagship (Sol variant)", desc_ar: "الرائد من OpenAI (نسخة سول)", is_premium: true },

  // ─── Gemini ───
  { model_id: "gemini-2.5-pro", family: "gemini", display_name_en: "Gemini 2.5 Pro", display_name_ar: "جيميناي 2.5 برو", desc_en: "Google's strong reasoning", desc_ar: "استدلال قوي من Google", is_premium: true },
  { model_id: "gemini-3-pro", family: "gemini", display_name_en: "Gemini 3 Pro", display_name_ar: "جيميناي 3 برو", desc_en: "Google's Pro model", desc_ar: "موديل برو من Google", is_premium: true },
  { model_id: "gemini-3.1-pro", family: "gemini", display_name_en: "Gemini 3.1 Pro", display_name_ar: "جيميناي 3.1 برو", desc_en: "Google's latest Pro model", desc_ar: "أحدث موديل برو من Google", is_premium: true },
  { model_id: "gemini-2.5-flash", family: "gemini", display_name_en: "Gemini 2.5 Flash", display_name_ar: "جيميناي 2.5 فلاش", desc_en: "Google's fast model", desc_ar: "موديل سريع من Google" },
  { model_id: "gemini-3-flash", family: "gemini", display_name_en: "Gemini 3 Flash", display_name_ar: "جيميناي 3 فلاش", desc_en: "Google's fast model", desc_ar: "موديل سريع من Google" },
  { model_id: "gemini-3.5-flash", family: "gemini", display_name_en: "Gemini 3.5 Flash", display_name_ar: "جيميناي 3.5 فلاش", desc_en: "Google's balanced model", desc_ar: "موديل متوازن من Google" },
  { model_id: "gemini-3.6-flash", family: "gemini", display_name_en: "Gemini 3.6 Flash", display_name_ar: "جيميناي 3.6 فلاش", desc_en: "Google's latest Flash", desc_ar: "أحدث فلاش من Google" },
  { model_id: "gemini-3.7-flash", family: "gemini", display_name_en: "Gemini 3.7 Flash", display_name_ar: "جيميناي 3.7 فلاش", desc_en: "Google's latest Flash", desc_ar: "أحدث فلاش من Google" },
  { model_id: "gemini-3.8-flash", family: "gemini", display_name_en: "Gemini 3.8 Flash", display_name_ar: "جيميناي 3.8 فلاش", desc_en: "Google's latest Flash", desc_ar: "أحدث فلاش من Google" },

  // ─── Grok ───
  { model_id: "grok-4.3", family: "grok", display_name_en: "Grok 4.3", display_name_ar: "جروك 4.3", desc_en: "xAI's Grok model", desc_ar: "موديل جروك من xAI" },
  { model_id: "grok-4.5", family: "grok", display_name_en: "Grok 4.5", display_name_ar: "جروك 4.5", desc_en: "xAI's Grok model", desc_ar: "موديل جروك من xAI" },
  { model_id: "grok-4.6", family: "grok", display_name_en: "Grok 4.6", display_name_ar: "جروك 4.6", desc_en: "xAI's latest Grok", desc_ar: "أحدث جروك من xAI", is_premium: true },
];

export const KIE_CHAT_FAMILY_LABELS: Record<KieChatModel["family"], { en: string; ar: string }> = {
  gpt: { en: "GPT (OpenAI)", ar: "جي بي تي (OpenAI)" },
  claude: { en: "Claude (Anthropic)", ar: "كلود (Anthropic)" },
  gemini: { en: "Gemini (Google)", ar: "جيميناي (Google)" },
  grok: { en: "Grok (xAI)", ar: "جروك (xAI)" },
};