import { execFileSync } from "node:child_process";
import path from "node:path";
import { E2E_PAYSTACK } from "./env";
import { startFakePaystack } from "./fake-paystack";

/** Fresh seed before every run, plus the fake Paystack the app server is pointed at. */
export default async function globalSetup() {
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "seed"], { stdio: "inherit" });
  const paystack = await startFakePaystack(E2E_PAYSTACK);
  return () => new Promise<void>((resolve) => paystack.close(() => resolve()));
}
