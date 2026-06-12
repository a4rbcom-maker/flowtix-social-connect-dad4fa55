// PM2 ecosystem — cluster mode for zero-downtime reloads.
//
// Why cluster + 2 instances:
//   `pm2 reload` in cluster mode restarts workers ONE AT A TIME and only
//   after the new worker starts listening. While worker A is restarting,
//   worker B keeps serving traffic on the same port → clients never see a
//   502/connection refused during deploys. Fork mode does NOT support this.
//
// kill_timeout: how long PM2 waits for in-flight requests to finish on the
// OLD worker before SIGKILL. 10s covers normal SSR responses comfortably.
//
// listen_timeout: how long PM2 waits for the NEW worker to bind the port
// before considering the reload failed. If it times out, the old worker is
// kept and the reload fails loudly — which is what we want.
module.exports = {
  apps: [
    {
      name: process.env.APP_NAME || "flowtixtools-web",
      script: "scripts/tanstack-node-server.mjs",
      cwd: process.env.DEPLOY_PATH || process.cwd(),
      interpreter: "node",
      instances: 2,
      exec_mode: "cluster",
      // PM2 APM/tracing wraps Node's HTTP parser through @pm2/io. It can
      // throw ERR_INVALID_URL for malformed public requests such as `GET //`,
      // which made deploy restarts fail even when the bundle itself was valid.
      pmx: false,
      automation: false,
      trace: false,
      disable_trace: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 10000,
      listen_timeout: 30000,
      wait_ready: false,
      env: {
        NODE_ENV: "production",
        PORT: process.env.APP_PORT || "3100",
        SERVER_ENTRY: process.env.SERVER_ENTRY || "",
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
