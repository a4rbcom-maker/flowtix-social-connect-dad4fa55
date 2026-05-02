ALTER TABLE public.facebook_connections
ADD COLUMN IF NOT EXISTS fb_user_email TEXT;