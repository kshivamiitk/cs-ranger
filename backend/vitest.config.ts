import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The backend uses ESM-style relative imports with explicit ".js"
    // extensions that point at ".ts" sources (resolved by tsx at runtime).
    // Strip the extension so Vite/Vitest resolves the TypeScript file.
    alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: "$1" }],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Unit tests only — no Supabase/Razorpay/Redis required, fully deterministic.
    testTimeout: 10_000,
  },
});
