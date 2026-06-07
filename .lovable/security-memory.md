# Security Memory

## Accepted/Intentional patterns (do NOT re-flag)

- **public.has_role(uuid, app_role)** is SECURITY DEFINER and intentionally executable by `authenticated`. It's the canonical role-check helper invoked from RLS policies across user-data tables. Body only does a scoped SELECT on `public.user_roles` and returns boolean. Revoking EXECUTE would break RLS. Do NOT switch it to SECURITY INVOKER (that re-introduces RLS recursion on `user_roles`).
- **realtime.messages** lacks RLS by design — access is gated by row-level filters on source tables that publish into it.
- **user_roles** writes are service-role only (no INSERT/UPDATE/DELETE policies for authenticated). Role changes go through the admin server functions in `src/lib/admin.functions.ts`.

## Required invariants

- All other `SECURITY DEFINER` functions in `public` (`handle_new_user`, `admin_kpi_snapshot`, `admin_daily_timeseries`, plus any new ones) MUST have EXECUTE revoked from `PUBLIC, anon, authenticated`. Grant EXECUTE only to `service_role` if a server function needs to call them.
- Sensitive credential columns (`facebook_connections.access_token`, `fb_bot_accounts.encrypted_payload`, `whatsapp_settings.meta_access_token` / `meta_verify_token`) MUST NOT have column-level SELECT granted to `anon` or `authenticated`. Server code reads them via `supabaseAdmin`.
- Storage bucket `fb-media` is public-read for CDN URLs but list/write is scoped to `(auth.uid())::text = (storage.foldername(name))[1]`.
