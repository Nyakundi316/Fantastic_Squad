import path from "node:path";
import { defineConfig } from "vitest/config";

// Local runs read .env; CI provides the variables directly (existing values are never overridden).
try {
  process.loadEnvFile(".env");
} catch {
  /* no .env file */
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // Same JSX runtime as Next, so server-side TSX (the invoice PDF) needs no React import.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl ?? "",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "test-secret-that-is-at-least-32-characters-long",
      APP_URL: "http://localhost:3000",
      SMS_PROVIDER: "console",
      EMAIL_PROVIDER: "console",
      OTP_DEV_CODE: "",
      // Paystack is never called for real in tests: fetch is stubbed and webhooks are signed with this key.
      PAYSTACK_SECRET_KEY: "sk_test_fantasticzone_vitest",
      PAYSTACK_BASE_URL: "https://paystack.test",
      CRON_SECRET: "cron-secret-for-vitest",
    },
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          // One shared test database, so files run one at a time in a single process.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 15_000,
          hookTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/server/**/*.ts", "src/middleware.ts"],
      reporter: ["text-summary", "text", "html"],
      // Release gate (hard rule 10): the allocation algorithm must stay at 100%.
      thresholds: {
        "src/server/allocation/allocate.ts": { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});
