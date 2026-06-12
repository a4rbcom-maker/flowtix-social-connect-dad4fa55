CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  description_ar text DEFAULT '',
  description_en text DEFAULT '',
  price numeric(10,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'SAR',
  billing_period text NOT NULL DEFAULT 'monthly',
  credits integer NOT NULL DEFAULT 0,
  features_ar text[] NOT NULL DEFAULT '{}',
  features_en text[] NOT NULL DEFAULT '{}',
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  is_popular boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plans TO anon;
GRANT SELECT ON public.plans TO authenticated;
GRANT ALL ON public.plans TO service_role;

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active plans"
  ON public.plans FOR SELECT
  USING (is_active = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert plans"
  ON public.plans FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update plans"
  ON public.plans FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete plans"
  ON public.plans FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER plans_set_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.plans (slug, name_ar, name_en, price, currency, credits, features_ar, features_en, is_popular, sort_order)
VALUES
  ('free', 'مجاني', 'Free', 0, 'SAR', 100,
   ARRAY['حساب واتساب واحد','100 رسالة شهرياً','مجموعة فيسبوك واحدة','دعم بريد إلكتروني'],
   ARRAY['1 WhatsApp account','100 messages / month','1 Facebook group','Email support'],
   false, 1),
  ('pro', 'احترافي', 'Pro', 99, 'SAR', 5000,
   ARRAY['5 حسابات واتساب','5,000 رسالة شهرياً','10 مجموعات فيسبوك','ردود ذكية بالذكاء الاصطناعي','دعم أولوية على مدار الساعة','تقارير وإحصائيات متقدمة'],
   ARRAY['5 WhatsApp accounts','5,000 messages / month','10 Facebook groups','AI smart replies','24/7 priority support','Advanced analytics'],
   true, 2),
  ('business', 'الأعمال', 'Business', 299, 'SAR', 25000,
   ARRAY['حسابات واتساب غير محدودة','25,000 رسالة شهرياً','مجموعات فيسبوك غير محدودة','API مخصص للتكامل','مدير حساب مخصص','SLA ضمان جودة الخدمة'],
   ARRAY['Unlimited WhatsApp accounts','25,000 messages / month','Unlimited Facebook groups','Custom integration API','Dedicated account manager','SLA guarantee'],
   false, 3);