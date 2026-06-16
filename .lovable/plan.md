## Fix: قفل جدول user_roles ضد الترقية الذاتية للأدمن

المشكلة: جدول `user_roles` فيه فقط policy للقراءة، فأي مستخدم مسجّل يقدر يـ INSERT صف لنفسه بدور `admin` ويتجاوز كل فحوصات `has_role()`.

### الحل (migration واحد)

إضافة 3 سياسات admin-only على `user_roles`:

```sql
-- Only admins can grant roles
CREATE POLICY "Admins can insert roles" ON public.user_roles
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Only admins can update roles
CREATE POLICY "Admins can update roles" ON public.user_roles
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Only admins can revoke roles
CREATE POLICY "Admins can delete roles" ON public.user_roles
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
```

### ملاحظات

- `has_role` موجودة فعلاً كـ SECURITY DEFINER، فمفيش recursion.
- الكود الموجود اللي بينشئ admins (مثل `scripts/update-admin.ts` أو أي seeding) لازم يستخدم service role — وده موجود بالفعل، فمش هيتأثر.
- أول admin بيتعمل يدويًا عبر SQL/service role (مش من الـ client) فمفيش chicken-and-egg.
- الـ trigger `handle_new_user` بيكتب في `profiles` فقط، مش في `user_roles`، فالـ signup العادي مش هيتأثر.

بعد الـ migration هتختفي finding `user_roles_missing_insert_delete_policy`.
