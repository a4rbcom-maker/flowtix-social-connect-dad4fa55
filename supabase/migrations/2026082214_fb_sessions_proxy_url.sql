-- Per-session proxy (BYOP): user-provided proxy URL attached to the FB
-- session itself. Takes priority over env vars (FB_PROXY_{ID}, PROXY_URL)
-- so each account can browse Facebook through its own stable IP.
alter table public.fb_sessions
  add column if not exists proxy_url text;

comment on column public.fb_sessions.proxy_url is
  'Optional user-provided proxy URL (http/https/socks5) used for this session browser context. Kept per-session; never shared across sessions.';
