import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const { error } = await sb
    .from("extraction_jobs")
    .update({
      status: "failed",
      error: "أُلغيت تلقائياً: المهمة علقت بسبب باج في النسخة القديمة (فشل صامت في إنشاء سياق الجلسات). حدّث خدمة الاستخراج إلى أحدث إصدار.",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", "de941feb-bd20-4c49-8a22-227f37677d54");

  if (error) {
    console.error("FAILED:", error.message);
    process.exit(1);
  }
  console.log("stuck job marked failed — user can extract again now");

  const { data } = await sb.from("extraction_jobs").select("id, status, error").eq("id", "de941feb-bd20-4c49-8a22-227f37677d54").single();
  console.log("verify:", data?.status);
  process.exit(0);
}

main();
