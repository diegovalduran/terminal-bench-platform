/**
 * PM2 Ecosystem Configuration
 * 
 * This configuration file is used to run the worker service with PM2.
 * PM2 is a process manager that keeps the worker alive and restarts it on crashes.
 * 
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 stop worker
 *   pm2 restart worker
 *   pm2 logs worker
 *   pm2 monit
 */

module.exports = {
  apps: [
    {
      name: "terminal-bench-worker",
      script: "npm",
      args: "run worker",
      cwd: process.cwd(),
      instances: 1, // Run single instance (job queue handles concurrency)
      exec_mode: "fork",
      autorestart: true,
      watch: false, // Don't watch files in production
      max_memory_restart: "2G", // Restart if memory exceeds 2GB
      env: {
        NODE_ENV: "production",
        WORKER_POLL_INTERVAL_MS: "5000", // Poll every 5 seconds
        MAX_CONCURRENT_ATTEMPTS_PER_JOB: "10", // 10 parallel attempts per job
      },
      env_development: {
        NODE_ENV: "development",
        WORKER_POLL_INTERVAL_MS: "3000", // Poll more frequently in dev
        MAX_CONCURRENT_ATTEMPTS_PER_JOB: "10",
      },
      error_file: "./logs/worker-error.log",
      out_file: "./logs/worker-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      // Graceful shutdown settings
      kill_timeout: 30000, // 30 seconds to gracefully shutdown
      wait_ready: false,
      listen_timeout: 10000,
      // Restart settings
      min_uptime: "10s", // Consider app stable after 10 seconds
      max_restarts: 10, // Max restarts in 1 minute
      restart_delay: 4000, // Wait 4 seconds before restarting
    },
  ],
};

