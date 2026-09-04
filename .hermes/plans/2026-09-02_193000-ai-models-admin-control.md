# AI Models Admin Control — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** السوبر أدمن يتحكم في الموديلات النشطة اللي تظهر للمستخدمين من لوحة التحكم، بدل الـ hardcoded array.

**Architecture:** جدول `ai_models` في DB + لوحة تحكم في Admin + API يجلب الموديلات النشطة + فلترة في الواجهة.

**Tech Stack:** Supabase (PostgreSQL), React, TanStack Query, Tailwind v4

---

## Current State

| Component | File | Problem |
|---|---|---|
| Hardcoded models | `src/types/wa-ai.types.ts:19-25` | `AI_MODELS` array ثابت |
| Admin panel | `src/pages/admin/AdminAiProvidersPage.tsx` | يدير Providers فقط، لا يوجد تبويب Models |
| User page | `src/pages/dashboard/whatsapp/WaAIAgentPage.tsx:380` | يعرض كل `AI_MODELS` |
| Backend | `extraction-service/src/ai/kie-client.ts:51` | Cost map hardcoded |
| DB | `ai_provider_configs` | لا يوجد جدول `ai_models` |

## Proposed Approach

1. إنشاء جدول `ai_models` في DB
2. لوحة تحكم للموديلات في Admin
3. API/Repository لجلب الموديلات النشطة
4. تعديل صفحة المستخدم لجلب الموديلات من DB بدل الـ constant

---

## Task 1: Create `ai_models` table in DB

**Objective:** إنشاء جدول لتخزين موديلات AI المتاحة

**Files:**
- Create: `supabase/migrations/2026090219_ai_models_admin.sql`

**Migration:**

```sql
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
```

**Step 1: Apply migration**

Run: `cd D:/Projects/FlowTix && npx supabase db push` or apply via Supabase dashboard

**Step 2: Verify**

Run: `cd D:/Projects/FlowTix && npx supabase gen types typescript --linked > /dev/null 2>&1; echo "OK"`

---

## Task 2: Add `ai_models` to database types

**Objective:** تحديث `database.types.ts` بالجدول الجديد

**Files:**
- Modify: `src/types/database.types.ts`

**Step 1: Regenerate types**

Run: `cd D:/Projects/FlowTix && npx supabase gen types typescript --linked --schema public > src/types/database.types.ts`

**Step 2: Verify `ai_models` exists in types**

Run: `grep -n "ai_models" src/types/database.types.ts | head -5`

Expected: shows Rows, Insert, Update definitions

---

## Task 3: Create `waAiModels` repository

**Objective:** Repository للتعامل مع جدول الموديلات

**Files:**
- Create: `src/lib/wa-ai-models.ts`

**Implementation:**

```typescript
import { supabase } from "@/lib/supabase";

export interface AiModel {
  id: string;
  model_id: string;
  provider: string;
  display_name: Record<string, string>;
  description: Record<string, string>;
  is_active: boolean;
  is_premium: boolean;
  sort_order: number;
  cost_per_1k_tokens: number | null;
}

export const waAiModelsRepository = {
  async listActive(): Promise<AiModel[]> {
    const { data, error } = await supabase
      .from("ai_models")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []) as AiModel[];
  },

  async listAll(): Promise<AiModel[]> {
    const { data, error } = await supabase
      .from("ai_models")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []) as AiModel[];
  },

  async save(input: Partial<AiModel> & { id?: string }): Promise<void> {
    if (input.id) {
      await supabase.from("ai_models").update(input).eq("id", input.id);
    } else {
      await supabase.from("ai_models").insert(input as any);
    }
  },

  async delete(id: string): Promise<void> {
    await supabase.from("ai_models").delete().eq("id", id);
  },

  async toggleActive(id: string, isActive: boolean): Promise<void> {
    await supabase.from("ai_models").update({ is_active: isActive }).eq("id", id);
  },
};
```

**Step 1: Write file**

**Step 2: Type check**

Run: `cd D:/Projects/FlowTix && npm run typecheck`
Expected: no errors

---

## Task 4: Create `useWaAiModels` hook

**Objective:** React Query hook لجلب الموديلات النشطة

**Files:**
- Create: `src/hooks/useWaAiModels.ts`

**Implementation:**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { waAiModelsRepository } from "@/lib/wa-ai-models";

const KEY = "wa-ai-models";

export function useWaAiModels() {
  return useQuery({
    queryKey: [KEY],
    queryFn: () => waAiModelsRepository.listActive(),
    staleTime: 5 * 60 * 1000, // 5 min cache
  });
}

export function useWaAiModelsAdmin() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [KEY, "admin"],
    queryFn: () => waAiModelsRepository.listAll(),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      waAiModelsRepository.toggleActive(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => waAiModelsRepository.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });

  const save = useMutation({
    mutationFn: (input: Parameters<typeof waAiModelsRepository.save>[0]) =>
      waAiModelsRepository.save(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });

  return { query, toggle, remove, save };
}
```

**Step 1: Write file**

**Step 2: Type check**

Run: `cd D:/Projects/FlowTix && npm run typecheck`
Expected: no errors

---

## Task 5: Create Admin Models management UI

**Objective:** لوحة تحكم للموديلات في صفحة Admin AI Providers

**Files:**
- Modify: `src/pages/admin/AdminAiProvidersPage.tsx`

**Step 1: Add state for models tab**

Add after line ~38:
```typescript
const [showModelDialog, setShowModelDialog] = useState(false);
const [editModel, setEditModel] = useState<AiModel | null>(null);
const [modelForm, setModelForm] = useState({ model_id: "", display_name_en: "", display_name_ar: "", desc_en: "", desc_ar: "", is_premium: false });
```

**Step 2: Import hooks and types**

Add to imports:
```typescript
import { useWaAiModelsAdmin } from "@/hooks/useWaAiModels";
import type { AiModel } from "@/lib/wa-ai-models";
```

**Step 3: Add models data loading**

Add after `kieService` usage:
```typescript
const { query: modelsData, toggle: toggleModel, remove: removeModel, save: saveModel } = useWaAiModelsAdmin();
```

**Step 4: Add "Models" tab next to "Accounts"**

Add a segmented control or tabs to switch between Accounts and Models views.

**Step 5: Models list UI**

Show table/cards with:
- Model name (display_name)
- Provider badge
- Active toggle
- Premium badge
- Edit/Delete buttons

**Step 6: Add/Edit dialog**

Form fields:
- model_id (text input)
- display_name_en / display_name_ar
- description_en / description_ar
- is_premium (checkbox)
- cost_per_1k_tokens (number)

**Step 7: Type check & build**

Run: `cd D:/Projects/FlowTix && npm run typecheck && npm run build`
Expected: success

---

## Task 6: Update `WaAIAgentPage` to use DB models

**Objective:** صفحة المستخدم تجلب الموديلات من DB بدل الـ hardcoded

**Files:**
- Modify: `src/pages/dashboard/whatsapp/WaAIAgentPage.tsx`

**Step 1: Replace hardcoded import**

Remove:
```typescript
import { AI_MODELS, AI_LEVELS } from "@/types/wa-ai.types";
```

Add:
```typescript
import { useWaAiModels } from "@/hooks/useWaAiModels";
import { AI_LEVELS } from "@/types/wa-ai.types";
```

**Step 2: Load models from DB**

Add inside component:
```typescript
const { data: aiModels, isLoading: modelsLoading } = useWaAiModels();
```

**Step 3: Replace `AI_MODELS.map` usage**

Change line ~380 from:
```typescript
const modelOptions = AI_MODELS.map((m) => ({
  value: m.id,
  label: `${m.id} — ${m.desc[locale]}`,
}));
```

To:
```typescript
const modelOptions = (aiModels ?? []).map((m) => ({
  value: m.model_id,
  label: `${m.display_name[locale] ?? m.model_id} — ${m.description[locale] ?? ""}`,
}));
```

**Step 4: Update models count in Stat**

Change line ~226 from:
```typescript
<Stat icon={Sparkles} label="Models" value={AI_MODELS.length} />
```

To:
```typescript
<Stat icon={Sparkles} label="Models" value={aiModels?.length ?? 0} />
```

**Step 5: Handle loading state**

Show skeleton or disabled state when `modelsLoading` is true.

**Step 6: Type check & build**

Run: `cd D:/Projects/FlowTix && npm run typecheck && npm run build`
Expected: success

---

## Task 7: Update backend cost map (optional, future)

**Objective:** Backend يستخدم نفس جدول الموديلات لحساب التكلفة

**Files:**
- Modify: `extraction-service/src/ai/kie-client.ts`

**Note:** This is a stretch goal. The hardcoded cost map works for now. Future migration: load costs from `ai_models` table.

---

## Task 8: Commit and push

**Objective:** نشر التغييرات

**Step 1: Commit each task**

```bash
git add supabase/migrations/2026090219_ai_models_admin.sql
git commit -m "feat(ai): add ai_models table for admin-controlled model list"

git add src/lib/wa-ai-models.ts src/hooks/useWaAiModels.ts
git commit -m "feat(ai): add repository and hooks for AI models"

git add src/pages/admin/AdminAiProvidersPage.tsx
git commit -m "feat(admin): add AI models management tab"

git add src/pages/dashboard/whatsapp/WaAIAgentPage.tsx
git commit -m "feat(ai-agent): load models from DB instead of hardcoded"
```

**Step 2: Push**

```bash
git push origin main
```

---

## Verification Checklist

- [ ] السوبر أدمن يقدر يفعّل/يعطّل أي موديل
- [ ] السوبر أدمن يقدر يضيف موديل جديد
- [ ] المستخدم يشوف الموديلات النشطة فقط
- [ ] الموديلات المخفية ما تظهرش في dropdown
- [ ] الصفحة تشتغل بدون أخطاء في الـ typecheck والـ build

---

## Risks & Tradeoffs

| Risk | Mitigation |
|---|---|
| Migration يفشل لو الجدول موجود | Use `IF NOT EXISTS` |
| المستخدم ما يشوف أي موديل لو DB فاضي | Seed default data in migration |
| Breaking change في الـ cost calculation | Keep hardcoded map as fallback |
| RLS يمنع المستخدمين من قراءة الموديلات | Policy: `is_active = true OR is_super_admin()` |

---

## Open Questions

1. هل نحتاج `is_premium` flag دلوقتي ولا نؤجله؟
2. هل السوبر أدمن يقدر يضيف providers جديدة (مش kie بس)؟
3. هل نحتاج API endpoint يجلب الموديلات ولا يكفي Supabase client؟
