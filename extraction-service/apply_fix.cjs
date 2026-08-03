require("dotenv").config();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sql = [
  "DROP FUNCTION IF EXISTS public.soft_delete_fb_session(UUID);",
  "DROP FUNCTION IF EXISTS public.soft_delete_fb_session(UUID, UUID);",
  "DROP FUNCTION IF EXISTS public.soft_delete_fb_session(p_session_id UUID);",
  "DROP FUNCTION IF EXISTS public.soft_delete_fb_session(p_session_id UUID, p_user_id UUID);",
  "CREATE FUNCTION public.soft_delete_fb_session(p_session_id UUID) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$",
  "DECLARE v_session_user_id UUID;",
  "BEGIN",
  "  SELECT user_id INTO v_session_user_id FROM public.fb_sessions WHERE id = p_session_id AND deleted_at IS NULL;",
  "  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;",
  "  IF NOT public.is_super_admin() AND v_session_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;",
  "  UPDATE public.fb_sessions SET deleted_at = now(), deleted_by = auth.uid(), status = 'disconnected', updated_at = now() WHERE id = p_session_id;",
  "END;",
  "$$;",
  "GRANT EXECUTE ON FUNCTION public.soft_delete_fb_session(UUID) TO authenticated;",
].join("\n");

async function main() {
  console.log("Trying /pg/query endpoint...");
  try {
    const r1 = await fetch(url + "/pg/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key, apikey: key },
      body: JSON.stringify({ query: sql }),
    });
    console.log("  Status:", r1.status);
    const t1 = await r1.text();
    console.log("  Body:", t1.substring(0, 500));
    if (r1.ok) {
      console.log("\nSUCCESS via /pg/query!");
      return;
    }
  } catch (e) {
    console.log("  Error:", e.message);
  }

  console.log("\nTrying /rest/v1/rpc with exec_sql...");
  try {
    const r2 = await fetch(url + "/rest/v1/rpc/exec_sql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key, apikey: key },
      body: JSON.stringify({ sql_text: sql }),
    });
    console.log("  Status:", r2.status);
    const t2 = await r2.text();
    console.log("  Body:", t2.substring(0, 500));
  } catch (e) {
    console.log("  Error:", e.message);
  }
}
main();
