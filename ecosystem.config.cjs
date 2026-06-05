const backendServices = [
  ["cs-api-gateway", "api-gateway"],
  ["cs-auth-service", "auth-service"],
  ["cs-user-service", "user-service"],
  ["cs-course-service", "course-service"],
  ["cs-enrollment-service", "enrollment-service"],
  ["cs-search-service", "search-service"],
  ["cs-payment-service", "payment-service"],
  ["cs-wallet-service", "wallet-service"],
  ["cs-payout-service", "payout-service"],
  ["cs-notification-service", "notification-service"],
  ["cs-support-service", "support-service"],
  ["cs-achievement-service", "achievement-service"],
  ["cs-analytics-service", "analytics-service"],
];

// Crash-loop hardening shared by every app. When a process exits unexpectedly
// (a missing env var, a transient Supabase/Redis blip, an unhandled rejection)
// PM2 used to restart it INSTANTLY, hundreds of times a minute — that's the
// huge ↺ restart counts on the backend services, and every loop made the
// gateway flap and tripped the uptime alert. With exponential backoff each
// successive restart waits longer (200ms → … capped ~15s) so a crash becomes a
// quiet, self-healing retry instead of a storm. `min_uptime` means a process
// has to stay up 20s to count as a clean start, so a fast boot-crash is treated
// as unstable and backed off rather than hammered.
const restartPolicy = {
  autorestart: true,
  min_uptime: "20s",
  exp_backoff_restart_delay: 200,
  kill_timeout: 5000,
};

module.exports = {
  apps: [
    {
      name: "cs-frontend",
      cwd: "./frontend",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
      },
      // Headroom for Next.js so a busy (not leaking) process isn't
      // killed-and-restarted mid-request. The prod VM has ~16 GB RAM so this is
      // comfortable; tune down only on a genuinely small (<=2 GB) box.
      max_memory_restart: "1536M",
      time: true,
      ...restartPolicy,
    },
    ...backendServices.map(([name, workspace]) => ({
      name,
      cwd: "./backend",
      script: "npm",
      args: `run start -w ${workspace}`,
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "512M",
      time: true,
      ...restartPolicy,
    })),
  ],
};
