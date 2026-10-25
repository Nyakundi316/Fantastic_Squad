import { defineConfig, devices } from "@playwright/test";
import { E2E_PAYSTACK, E2E_PORT } from "./e2e/env";

try {
  process.loadEnvFile(".env");
} catch {
  /* CI sets env directly */
}

const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: "e2e",
  // Specs share the seeded database and build on each other's data.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", testIgnore: /ops-.*\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 860 } } },
    // §2 rule 11: customer screens must work at 375px.
    {
      name: "mobile",
      testIgnore: /ops-.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
    },
    // Staff flows close and invoice the seeded batch, so they run after the customer specs are done with it.
    {
      name: "ops",
      testMatch: /ops-.*\.spec\.ts/,
      dependencies: ["desktop", "mobile"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 860 } },
    },
  ],
  webServer: {
    command: `npm run start -- -p ${E2E_PORT}`,
    url: baseURL,
    // Always a fresh server: it must run with the fake Paystack settings below.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PAYSTACK_SECRET_KEY: E2E_PAYSTACK.secret,
      PAYSTACK_BASE_URL: `http://localhost:${E2E_PAYSTACK.port}`,
      APP_URL: baseURL,
    },
  },
});
