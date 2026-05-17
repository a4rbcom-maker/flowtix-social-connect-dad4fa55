module.exports = {
  apps: [
    {
      name: process.env.APP_NAME || "flowtixtools-web",
      script: "scripts/tanstack-node-server.mjs",
      cwd: process.env.DEPLOY_PATH || process.cwd(),
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
        PORT: process.env.APP_PORT || "3100",
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