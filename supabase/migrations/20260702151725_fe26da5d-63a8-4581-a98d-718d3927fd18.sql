CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flowtix-bulk-jobs-tick') THEN
    PERFORM cron.unschedule('flowtix-bulk-jobs-tick');
  END IF;
END $$;