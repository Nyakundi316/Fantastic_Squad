import { execFileSync } from "node:child_process";
import path from "node:path";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set; integration tests need their own database.");
  if (url === process.env.DATABASE_URL && !url.includes("test")) {
    throw new Error("TEST_DATABASE_URL must not point at the development database.");
  }

  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
