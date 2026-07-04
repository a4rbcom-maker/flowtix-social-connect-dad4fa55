/**
 * Integration guardrail — dashboard.whatsapp.inbox.tsx
 *
 * يتحقق أن الصفحة تعرض الرسائل صح وتشغّل Realtime بدون أخطاء شائعة:
 *   1) اشتراك Realtime داخل useEffect مع cleanup عبر removeChannel
 *      (يمنع تسرّب الاشتراكات وحلقات إعادة الاتصال المكلفة).
 *   2) الاشتراك على جدولَي wa_conversations و wa_messages مع فلتر user_id
 *      (يمنع تسريب بيانات مستخدمين آخرين إلى الـInbox).
 *   3) قائمة الرسائل تفلتر بـ isMessageForActiveConversation وتبني الاستعلام
 *      عبر buildInboxMessageQueryPlan (منع خلط جروب/خاص).
 *   4) عنصر الرسالة يستخدم key ثابت مبني على m.id لا index — يمنع
 *      إعادة استخدام DOM لرسائل مختلفة عند التبديل بين المحادثات.
 *   5) عرض الرسائل يمرّ عبر مكوّن ChatBubble واحد (لا تكرار تصيير).
 *
 * الاختبار source-level بدون jsdom لأن الصفحة ضخمة (>3.7K سطر) والـ
 * vitest يعمل في بيئة node. الهدف قفل السلوك عبر أي refactor لاحق.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const filePath = path.resolve(__dirname, "../dashboard.whatsapp.inbox.tsx");
const source = readFileSync(filePath, "utf8");
// جرّد التعليقات كي لا تُحسب كسلوك.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("inbox — realtime subscription is safe", () => {
  it("يشترك على قناة supabase.channel مرة واحدة داخل useEffect", () => {
    const channelCalls = [...code.matchAll(/supabase\s*\.\s*channel\s*\(/g)];
    expect(channelCalls.length, "توقع اشتراك واحد فقط على قناة realtime").toBe(1);
    // نتأكد أن الاشتراك موجود داخل useEffect: نبحث عن آخر useEffect قبل channel.
    const chIdx = channelCalls[0].index ?? -1;
    const useEffectIdx = code.lastIndexOf("useEffect", chIdx);
    expect(useEffectIdx, "supabase.channel يجب أن يكون داخل useEffect").toBeGreaterThan(-1);
    // المسافة بين useEffect وchannel يجب أن تكون معقولة (نفس البلوك).
    expect(chIdx - useEffectIdx).toBeLessThan(500);
  });

  it("ينظّف الاشتراك عبر supabase.removeChannel في return الخاص بـuseEffect", () => {
    expect(/return\s*\(\s*\)\s*=>\s*\{[^}]*supabase\.removeChannel\s*\(/.test(code)).toBe(true);
  });

  it("يشترك على جدولَي wa_conversations و wa_messages مع فلتر user_id", () => {
    const conv = /table:\s*["']wa_conversations["'][^}]*filter:\s*`user_id=eq\.\$\{[^}]+\}`/;
    const msg = /table:\s*["']wa_messages["'][^}]*filter:\s*`user_id=eq\.\$\{[^}]+\}`/;
    expect(conv.test(code), "اشتراك wa_conversations بدون فلتر user_id").toBe(true);
    expect(msg.test(code), "اشتراك wa_messages بدون فلتر user_id").toBe(true);
  });

  it("يستخدم postgres_changes وليس broadcast/presence", () => {
    expect(code.includes('"postgres_changes"')).toBe(true);
  });
});

describe("inbox — message list rendering", () => {
  it("يفلتر الرسائل بـ isMessageForActiveConversation قبل العرض", () => {
    expect(code.includes("isMessageForActiveConversation(m.remote_jid, activeJid)")).toBe(true);
  });

  it("استعلامات wa_messages محصورة في مسارَي جروب/خاص فقط ومحميّة بشرط الاستبعاد", () => {
    expect(code.includes("buildInboxMessageQueryPlan(")).toBe(true);
    const directQuery = /\.from\(["']wa_messages["']\)\s*\.select/g;
    const matches = [...code.matchAll(directQuery)];
    // مسار واحد لجروبات (@g.us) ومسار واحد للخاص المحكوم بـ plan — لا ثالث.
    expect(matches.length).toBe(2);
    // مسار الخاص لازم يحوي شيلد استبعاد @g.us لمنع تسرّب رسائل الجروب.
    expect(code.includes('.not("remote_jid", "like", "%@g.us")')).toBe(true);
  });

  it("مفتاح ChatBubble هو m.id (فريد) وليس index", () => {
    expect(/<ChatBubble\s+key=\{m\.id\}/.test(code)).toBe(true);
    // نمنع تصيير الرسالة بـ key={i} (index) الذي يسبب اختلاط عناصر DOM.
    const bubbleWithIndexKey = /<ChatBubble\s+key=\{i\}/;
    expect(bubbleWithIndexKey.test(code)).toBe(false);
  });

  it("فاصل التاريخ يستخدم مفتاحًا مركّبًا يتضمن m.id", () => {
    expect(/key=\{`day-\$\{dk\}-\$\{m\.id\}`\}/.test(code)).toBe(true);
  });
});

describe("inbox — no runtime hazards", () => {
  it("لا يوجد supabase.channel خارج useEffect (يمنع leaks عبر re-renders)", () => {
    // كل channel(...) يجب أن يسبقه useEffect قريب.
    const channels = [...code.matchAll(/supabase\s*\.\s*channel\s*\(/g)];
    for (const m of channels) {
      const idx = m.index ?? 0;
      const before = code.slice(Math.max(0, idx - 400), idx);
      expect(before.includes("useEffect"), "channel يجب أن يكون داخل useEffect قريب").toBe(true);
    }
  });

  it("لا يستدعي setState داخل جسم المكوّن (خارج hooks/handlers) بشكل مباشر", () => {
    // نبحث عن نمط `setX(...)` كسطر مستقل خارج useEffect/useMemo/handler.
    // فحص خفيف: نتأكد لا يوجد `useState` يليه استدعاء setX فورًا بدون sep.
    const bad = /\bconst\s+\[[^,]+,\s*(set\w+)\]\s*=\s*useState[^;]+;\s*\1\(/;
    expect(bad.test(code)).toBe(false);
  });
});
