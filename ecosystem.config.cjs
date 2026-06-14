// PM2 ecosystem — one forked web process on one port.
// Keep a single instance to prevent duplicate listeners/EADDRINUSE on 3001.
// restart_delay + kill_timeout give Node time to release the socket before PM2 retries.
module.exports = {
  apps: [
    {
      name: process.env.APP_NAME || "flowtixtools-web",
      script: "scripts/tanstack-node-server.mjs",
      cwd: process.env.DEPLOY_PATH || process.cwd(),
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      // PM2 APM/tracing wraps Node's HTTP parser through @pm2/io. It can
      // throw ERR_INVALID_URL for malformed public requests such as `GET //`,
      // which made deploy restarts fail even when the bundle itself was valid.
      pmx: false,
      automation: false,
      trace: false,
      disable_trace: true,
      autorestart: true,
      max_restarts: 5,
      min_uptime: "10s",
      restart_delay: 3000,
      kill_timeout: 5000,
      listen_timeout: 30000,
      wait_ready: false,
      env: {
        NODE_ENV: "production",
        PORT: process.env.APP_PORT || "3001",
        SERVER_ENTRY: process.env.SERVER_ENTRY || "",
        SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
        VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "",
        BOT_ENCRYPTION_KEY: process.env.BOT_ENCRYPTION_KEY || "",
        BOT_WORKER_SECRET: process.env.BOT_WORKER_SECRET || "",
        CRON_SECRET: process.env.CRON_SECRET || process.env.BOT_WORKER_SECRET || "",
        DEPLOY_SHA: process.env.DEPLOY_SHA || "",
        DEPLOY_RUN_ID: process.env.DEPLOY_RUN_ID || "",
        DEPLOY_REPOSITORY: process.env.DEPLOY_REPOSITORY || "",
        DEPLOYED_AT: process.env.DEPLOYED_AT || "",
        FLOWTIX_ALERT_WEBHOOK_URL: process.env.FLOWTIX_ALERT_WEBHOOK_URL || "",
        ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL || "",
        SSR_ALERT_WEBHOOK_URL: process.env.SSR_ALERT_WEBHOOK_URL || "",
        ALERT_THROTTLE_MS: process.env.ALERT_THROTTLE_MS || "900000",
      },
    },
  ],
};
