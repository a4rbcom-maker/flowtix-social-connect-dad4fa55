-- Enable Graph API publishing path for fb_campaigns without breaking the existing bot path.
-- 1) account_id becomes nullable (Graph campaigns don't need a bot account).
ALTER TABLE public.fb_campaigns
  ALTER COLUMN account_id DROP NOT NULL;

-- 2) New columns to describe posting mode + link to the Graph connection.
ALTER TABLE public.fb_campaigns
  ADD COLUMN IF NOT EXISTS graph_connection_id uuid REFERENCES public.facebook_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posting_mode text NOT NULL DEFAULT 'bot_worker'
    CHECK (posting_mode IN ('bot_worker','graph_api'));

-- 3) A campaign must have EITHER a bot account (bot_worker) OR a graph connection (graph_api).
ALTER TABLE public.fb_campaigns
  DROP CONSTRAINT IF EXISTS fb_campaigns_account_source_chk;
ALTER TABLE public.fb_campaigns
  ADD CONSTRAINT fb_campaigns_account_source_chk CHECK (
    (posting_mode = 'bot_worker' AND account_id IS NOT NULL)
    OR
    (posting_mode = 'graph_api' AND graph_connection_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS fb_campaigns_graph_connection_idx
  ON public.fb_campaigns(graph_connection_id)
  WHERE graph_connection_id IS NOT NULL;