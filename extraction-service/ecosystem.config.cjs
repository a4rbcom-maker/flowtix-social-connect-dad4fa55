module.exports = {
  apps: [
    {
      name: "flowtix-extraction",
      script: "dist/index.js",
      cwd: "/www/wwwroot/api.flowtixtools.com",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
        PORT: 3100,
      },
      env_file: ".env",
      error_file: "/www/wwwroot/api.flowtixtools.com/logs/pm2-error.log",
      out_file: "/www/wwwroot/api.flowtixtools.com/logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      time: true,
    },
  ],
};
