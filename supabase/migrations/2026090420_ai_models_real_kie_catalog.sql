-- ============================================================
-- إصلاح ai_models: حذف الموديلات الوهمية (glm-flash, glm-5.2, deepseek-v4,
-- gpt-4o, claude-3-5-sonnet — غير موجودة في كتالوج kie.ai) وإدخال الكتالوج
-- الرسمي الكامل من src/lib/kie-chat-models-catalog.ts (27 موديل).
-- + تصحيح default العمود ai_provider_configs.models وإصلاح الإعدادات المحفوظة
--   التي تشير لموديلات وهمية.
-- الأسعار (cost_per_1k_tokens) تُترك NULL — لا أسعار رسمية معتمدة بعد.
-- ============================================================

-- 1) حذف الصفوف الوهمية
delete from ai_models where model_id in (
  'glm-flash', 'glm-5.2', 'deepseek-v4', 'gpt-4o', 'claude-3-5-sonnet'
);

-- 2) إدخال كتالوج kie.ai الرسمي (الترتيب = ترتيب الكتالوج في الكود)
insert into ai_models (model_id, provider, display_name, description, is_active, is_premium, sort_order) values
  -- Claude
  ('claude-opus-4.7',    'kie', '{"en":"Claude Opus 4.7","ar":"كلود أوبس 4.7"}',       '{"en":"Anthropic''s most capable Claude","ar":"أقوى موديلات Anthropic"}', true, true,  1),
  ('claude-opus-4.8',    'kie', '{"en":"Claude Opus 4.8","ar":"كلود أوبس 4.8"}',       '{"en":"Anthropic''s flagship reasoning model","ar":"موديل الاستدلال الرائد من Anthropic"}', true, true,  2),
  ('claude-fable-5',     'kie', '{"en":"Claude Fable 5","ar":"كلود فابل 5"}',          '{"en":"Anthropic''s creative writing model","ar":"موديل الكتابة الإبداعية من Anthropic"}', true, false, 3),
  ('claude-sonnet-5',    'kie', '{"en":"Claude Sonnet 5","ar":"كلود سونيت 5"}',        '{"en":"Anthropic''s balanced Claude","ar":"كلود المتوازن من Anthropic"}', true, false, 4),
  ('claude-haiku-4.5',   'kie', '{"en":"Claude Haiku 4.5","ar":"كلود هايكو 4.5"}',     '{"en":"Fast & economical","ar":"سريع واقتصادي"}', true, false, 5),
  ('claude-opus-4.5',    'kie', '{"en":"Claude Opus 4.5","ar":"كلود أوبس 4.5"}',       '{"en":"Anthropic''s flagship Claude","ar":"الرائد من Anthropic"}', true, true,  6),
  ('claude-opus-4.6',    'kie', '{"en":"Claude Opus 4.6","ar":"كلود أوبس 4.6"}',       '{"en":"Anthropic''s flagship Claude","ar":"الرائد من Anthropic"}', true, true,  7),
  ('claude-opus-5',      'kie', '{"en":"Claude Opus 5","ar":"كلود أوبس 5"}',           '{"en":"Next-gen Anthropic flagship","ar":"الجيل القادم من Anthropic"}', true, true,  8),
  ('claude-sonnet-4.5',  'kie', '{"en":"Claude Sonnet 4.5","ar":"كلود سونيت 4.5"}',    '{"en":"Anthropic''s balanced Claude","ar":"كلود المتوازن من Anthropic"}', true, false, 9),
  ('claude-sonnet-4.6',  'kie', '{"en":"Claude Sonnet 4.6","ar":"كلود سونيت 4.6"}',    '{"en":"Anthropic''s balanced Claude","ar":"كلود المتوازن من Anthropic"}', true, false, 10),
  -- GPT
  ('gpt-5.2',            'kie', '{"en":"GPT 5.2","ar":"جي بي تي 5.2"}',                '{"en":"OpenAI''s flagship","ar":"الرائد من OpenAI"}', true, true,  11),
  ('gpt-5.6-luna',       'kie', '{"en":"GPT 5.6 Luna","ar":"جي بي تي 5.6 لونا"}',      '{"en":"OpenAI''s flagship (Luna variant)","ar":"الرائد من OpenAI (نسخة لونا)"}', true, true,  12),
  ('gpt-5.6-terra',      'kie', '{"en":"GPT 5.6 Terra","ar":"جي بي تي 5.6 تيرا"}',     '{"en":"OpenAI''s flagship (Terra variant)","ar":"الرائد من OpenAI (نسخة تيرا)"}', true, true,  13),
  ('gpt-5.6-sol',        'kie', '{"en":"GPT 5.6 Sol","ar":"جي بي تي 5.6 سول"}',        '{"en":"OpenAI''s flagship (Sol variant)","ar":"الرائد من OpenAI (نسخة سول)"}', true, true,  14),
  -- Gemini
  ('gemini-2.5-pro',     'kie', '{"en":"Gemini 2.5 Pro","ar":"جيميناي 2.5 برو"}',      '{"en":"Google''s strong reasoning","ar":"استدلال قوي من Google"}', true, true,  15),
  ('gemini-3-pro',       'kie', '{"en":"Gemini 3 Pro","ar":"جيميناي 3 برو"}',          '{"en":"Google''s Pro model","ar":"موديل برو من Google"}', true, true,  16),
  ('gemini-3.1-pro',     'kie', '{"en":"Gemini 3.1 Pro","ar":"جيميناي 3.1 برو"}',      '{"en":"Google''s latest Pro model","ar":"أحدث موديل برو من Google"}', true, true,  17),
  ('gemini-2.5-flash',   'kie', '{"en":"Gemini 2.5 Flash","ar":"جيميناي 2.5 فلاش"}',   '{"en":"Google''s fast model","ar":"موديل سريع من Google"}', true, false, 18),
  ('gemini-3-flash',     'kie', '{"en":"Gemini 3 Flash","ar":"جيميناي 3 فلاش"}',       '{"en":"Google''s fast model","ar":"موديل سريع من Google"}', true, false, 19),
  ('gemini-3.5-flash',   'kie', '{"en":"Gemini 3.5 Flash","ar":"جيميناي 3.5 فلاش"}',   '{"en":"Google''s balanced model","ar":"موديل متوازن من Google"}', true, false, 20),
  ('gemini-3.6-flash',   'kie', '{"en":"Gemini 3.6 Flash","ar":"جيميناي 3.6 فلاش"}',   '{"en":"Google''s latest Flash","ar":"أحدث فلاش من Google"}', true, false, 21),
  ('gemini-3.7-flash',   'kie', '{"en":"Gemini 3.7 Flash","ar":"جيميناي 3.7 فلاش"}',   '{"en":"Google''s latest Flash","ar":"أحدث فلاش من Google"}', true, false, 22),
  ('gemini-3.8-flash',   'kie', '{"en":"Gemini 3.8 Flash","ar":"جيميناي 3.8 فلاش"}',   '{"en":"Google''s latest Flash","ar":"أحدث فلاش من Google"}', true, false, 23),
  -- Grok
  ('grok-4.3',           'kie', '{"en":"Grok 4.3","ar":"جروك 4.3"}',                   '{"en":"xAI''s Grok model","ar":"موديل جروك من xAI"}', true, false, 24),
  ('grok-4.5',           'kie', '{"en":"Grok 4.5","ar":"جروك 4.5"}',                   '{"en":"xAI''s Grok model","ar":"موديل جروك من xAI"}', true, false, 25),
  ('grok-4.6',           'kie', '{"en":"Grok 4.6","ar":"جروك 4.6"}',                   '{"en":"xAI''s latest Grok","ar":"أحدث جروك من xAI"}', true, true,  26)
on conflict (model_id) do update
  set provider = excluded.provider,
      display_name = excluded.display_name,
      description = excluded.description,
      is_premium = excluded.is_premium,
      sort_order = excluded.sort_order;

-- 3+4) تصحيح default العمود + الإعدادات المحفوظة — فقط إذا كان جدول الراوتر موجوداً
--      (whatsapp_ai_router.sql غير مُطبَّق في بعض البيئات — لا تفشل العملية بعدها)
do $$ begin
  if to_regclass('public.ai_provider_configs') is not null then
    execute 'alter table ai_provider_configs
      alter column models set default ''{"l1":"gemini-3.5-flash","l2":"gemini-3.7-flash","l3":"claude-sonnet-5"}''::jsonb';

    update ai_provider_configs
    set models = jsonb_build_object(
          'l1', case when models->>'l1' in ('glm-flash','glm-5.2','deepseek-v4','gpt-4o','claude-3-5-sonnet')
                     then 'gemini-3.5-flash' else models->>'l1' end,
          'l2', case when models->>'l2' in ('glm-flash','glm-5.2','deepseek-v4','gpt-4o','claude-3-5-sonnet')
                     then 'gemini-3.7-flash' else models->>'l2' end,
          'l3', case when models->>'l3' in ('glm-flash','glm-5.2','deepseek-v4','gpt-4o','claude-3-5-sonnet')
                     then 'claude-sonnet-5'  else models->>'l3' end
        )
    where (models->>'l1') in ('glm-flash','glm-5.2','deepseek-v4','gpt-4o','claude-3-5-sonnet')
       or (models->>'l2') in ('glm-flash','glm-5.2','deepseek-v4','gpt-4o','claude-3-5-sonnet')
       or (models->>'l3') in ('glm-flash','glm-5.2','deepseek-v4','gpt-4o','claude-3-5-sonnet');
  end if;
end $$;
