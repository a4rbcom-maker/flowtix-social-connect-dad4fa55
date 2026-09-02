-- AI Models table: super admin controls which models are available
create table if not exists ai_models (
  id uuid primary key default gen_random_uuid(),
  model_id text not null unique,           -- e.g. "glm-flash", "gpt-4o"
  provider text not null default 'kie',     -- e.g. "kie", "openai", "anthropic"
  display_name jsonb not null,              -- { "en": "GLM Flash", "ar": "جي إل إم فلاش" }
  description jsonb not null,               -- { "en": "Fast & economical", "ar": "سريع واقتصادي" }
  is_active boolean not null default true,  -- show to users?
  is_premium boolean not null default false,-- only for premium users?
  sort_order int not null default 0,        -- display order
  cost_per_1k_tokens numeric,               -- for cost tracking
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_models_active_idx on ai_models (is_active, sort_order);
create unique index ai_models_model_id_uniq on ai_models (model_id);

-- Seed default models
insert into ai_models (model_id, provider, display_name, description, is_active, sort_order, cost_per_1k_tokens) values
  ('glm-flash', 'kie', '{"en":"GLM Flash","ar":"جي إل إم فلاش"}', '{"en":"Fast & economical","ar":"سريع واقتصادي"}', true, 1, 0.0001),
  ('glm-5.2', 'kie', '{"en":"GLM 5.2","ar":"جي إل إم 5.2"}', '{"en":"Balanced","ar":"متوازن"}', true, 2, 0.002),
  ('deepseek-v4', 'kie', '{"en":"DeepSeek V4","ar":"ديب سيك V4"}', '{"en":"Balanced","ar":"متوازن"}', true, 3, 0.002),
  ('gpt-4o', 'openai', '{"en":"GPT-4o","ar":"جي بي تي 4o"}', '{"en":"Strong reasoning","ar":"استدلال قوي"}', true, 4, 0.005),
  ('claude-3-5-sonnet', 'anthropic', '{"en":"Claude 3.5 Sonnet","ar":"كلود 3.5 سونيت"}', '{"en":"Most capable","ar":"الأقوى"}', true, 5, 0.015)
on conflict (model_id) do nothing;

-- RLS: super admin manages, users read active only
alter table ai_models enable row level security;

create policy "ai_models_read_active" on ai_models for select
  using (is_active = true or is_super_admin());

create policy "ai_models_admin" on ai_models for all
  using (is_super_admin())
  with check (is_super_admin());

-- Trigger for updated_at
do $$ begin
  create trigger ai_models_updated_at before update on ai_models
  for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
