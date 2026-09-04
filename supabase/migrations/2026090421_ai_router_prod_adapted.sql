-- ============================================================================
-- AI Router — نسخة الإنتاج المكيّفة من whatsapp_ai_router.sql
-- طُبّقت على الإنتاج عبر Management API (2026-09-04).
--
-- تكييفات الإنتاج (الفرق عن الملف الأصلي):
--   1) جدول workspaces غير موجود في الإنتاج (حُذف بمشروع سابق) → أعمدة
--      workspace_id بدون FK (نفس نمط wa_conversations/wa_contacts، والقيم
--      الفعلية = user id — يطابق current_workspace_id() التي ترجع auth.uid()).
--   2) defaults الموديلات = كتالوج kie الرسمي (glm-* وهمية — انظر 2026090420).
--   3) جدول ai_instructions لم يكن في الملف الأصلي إطلاقاً رغم أن الواجهة
--      والراوتر يقرأانه → مُنشأ هنا بصلاحيات RLS كاملة.
--   4) عمود system_instructions على ai_provider_configs (الواجهة تعمل select عليه).
-- ============================================================================
BEGIN;

-- A1) Enums (موجودة مسبقاً — حماية)
do $$ begin create type ai_route_level as enum ('l1','l2','l3','human'); exception when duplicate_object then null; end $$;
do $$ begin create type ai_provider as enum ('kie'); exception when duplicate_object then null; end $$;

-- A2) أعمدة AI على wa_messages
alter table wa_messages add column if not exists ai_route_level ai_route_level;
alter table wa_messages add column if not exists ai_confidence double precision;
alter table wa_messages add column if not exists ai_latency_ms int;

-- A3) عمود ai_route_level على wa_conversations
alter table wa_conversations add column if not exists ai_route_level ai_route_level;

-- A4) Provider configs (workspace-level) — بدون FK لجدول workspaces
create table if not exists ai_provider_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  provider ai_provider not null default 'kie',
  name text not null default 'kie.ai',
  base_url text not null default 'https://api.kie.ai/v1',
  api_key_enc text,
  models jsonb not null default '{"l1":"gemini-3.5-flash","l2":"gemini-3.7-flash","l3":"claude-sonnet-5"}'::jsonb,
  settings jsonb not null default '{"l1_temperature":0.3,"l2_temperature":0.5,"l3_temperature":0.7,"max_tokens":1024,"timeout_ms":30000}'::jsonb,
  cost_caps jsonb not null default '{"daily_usd":10,"per_conversation_usd":0.5}'::jsonb,
  system_instructions text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ai_provider_configs_ws_uniq on ai_provider_configs (workspace_id, provider);
do $$ begin create trigger ai_provider_configs_updated_at before update on ai_provider_configs for each row execute function set_updated_at(); exception when duplicate_object then null; end $$;

-- A5) Router rules
create table if not exists ai_router_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  intent text not null,
  level ai_route_level not null,
  keywords text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ai_router_rules_ws_idx on ai_router_rules (workspace_id, is_active);

-- A6) Conversation memory
create table if not exists ai_conversation_memory (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  contact_id uuid not null references wa_contacts(id) on delete cascade,
  summary text,
  interests text[] not null default '{}',
  language text default 'ar',
  last_context jsonb not null default '{}'::jsonb,
  message_count int not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists ai_memory_contact_uniq on ai_conversation_memory (workspace_id, contact_id);
do $$ begin create trigger ai_memory_updated_at before update on ai_conversation_memory for each row execute function set_updated_at(); exception when duplicate_object then null; end $$;

-- A7) Knowledge base
create table if not exists ai_knowledge_base (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  title text not null,
  source_type text not null,
  content text not null,
  keywords text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_kb_ws_idx on ai_knowledge_base (workspace_id, is_active);
do $$ begin create trigger ai_kb_updated_at before update on ai_knowledge_base for each row execute function set_updated_at(); exception when duplicate_object then null; end $$;

-- A8) Invocations log
create table if not exists ai_invocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  conversation_id uuid references wa_conversations(id) on delete set null,
  contact_id uuid references wa_contacts(id) on delete set null,
  message_id uuid references wa_messages(id) on delete set null,
  level ai_route_level not null,
  intent text,
  model text not null,
  provider ai_provider not null default 'kie',
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  cost_usd numeric(12,6),
  latency_ms int,
  confidence double precision,
  success boolean not null default true,
  error text,
  escalated_to_human boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ai_invocations_ws_created_idx on ai_invocations (workspace_id, created_at desc);

-- A9) Agent instructions (الواجهة + الراوتر يقرأانه — كان ناقصاً من الملف الأصلي)
create table if not exists ai_instructions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  category text,
  instructions text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_instructions_ws_idx on ai_instructions (workspace_id, is_active, created_at desc);
do $$ begin create trigger ai_instructions_updated_at before update on ai_instructions for each row execute function set_updated_at(); exception when duplicate_object then null; end $$;

-- A10) RLS
alter table ai_provider_configs    enable row level security;
alter table ai_router_rules        enable row level security;
alter table ai_conversation_memory enable row level security;
alter table ai_knowledge_base      enable row level security;
alter table ai_invocations         enable row level security;
alter table ai_instructions        enable row level security;

do $$ begin
  create policy "select_ai_cfg" on ai_provider_configs for select
    using ((workspace_id = current_workspace_id()) OR is_super_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "insert_ai_cfg" on ai_provider_configs for insert
    with check (workspace_id = current_workspace_id());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "update_ai_cfg" on ai_provider_configs for update
    using ((workspace_id = current_workspace_id()) OR is_super_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "select_ai_rules" on ai_router_rules for select
    using ((workspace_id = current_workspace_id()) OR is_super_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "insert_ai_rules" on ai_router_rules for insert
    with check (workspace_id = current_workspace_id());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "update_ai_rules" on ai_router_rules for update
    using ((workspace_id = current_workspace_id()) OR is_super_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "delete_ai_rules" on ai_router_rules for delete
    using ((workspace_id = current_workspace_id()) OR is_super_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "select_ai_memory" on ai_conversation_memory for select
    using ((workspace_id = current_workspace_id()) OR is_super_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "upsert_ai_memory" on ai_conversation_memory for insert
    with check (workspace_id = current_workspace_id());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "update_ai_memory" on ai_conversation_memory for update
    using ((workspace_id = current_workspace_id()) OR is_super_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "select_ai_kb" on ai_knowledge_base for select
    using ((workspace_id = current_workspace_id()) OR is_super_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "insert_ai_kb" on ai_knowledge_base for insert
    with check (workspace_id = current_workspace_id());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "update_ai_kb" on ai_knowledge_base for update
    using ((workspace_id = current_workspace_id()) OR is_super_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "delete_ai_kb" on ai_knowledge_base for delete
    using ((workspace_id = current_workspace_id()) OR is_super_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "select_ai_invoc" on ai_invocations for select
    using ((workspace_id = current_workspace_id()) OR is_super_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "insert_ai_invoc" on ai_invocations for insert
    with check (workspace_id = current_workspace_id());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "select_ai_instr" on ai_instructions for select
    using ((workspace_id = current_workspace_id()) OR is_super_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "insert_ai_instr" on ai_instructions for insert
    with check (workspace_id = current_workspace_id());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "update_ai_instr" on ai_instructions for update
    using ((workspace_id = current_workspace_id()) OR is_super_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "delete_ai_instr" on ai_instructions for delete
    using ((workspace_id = current_workspace_id()) OR is_super_admin());
exception when duplicate_object then null; end $$;

-- A11) RPC: cost today (إعادة تعريف — نسخة قديمة بمعامل p_user_id موجودة أصلاً)
drop function if exists get_ai_cost_today(uuid);
create or replace function get_ai_cost_today(p_workspace_id uuid)
returns numeric language sql stable security definer as $$
  select coalesce(sum(cost_usd), 0) from ai_invocations
  where workspace_id = p_workspace_id and created_at >= date_trunc('day', now());
$$;

COMMIT;
