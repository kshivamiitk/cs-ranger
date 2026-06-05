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
      // 16 GB VM — give Next.js real headroom so a busy (not leaking) process
      // isn't killed-and-restarted mid-request (which looked like a "crash").
      max_memory_restart: "1536M",
      time: true,
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
    })),
  ],
};
