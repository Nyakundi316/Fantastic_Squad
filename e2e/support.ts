import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, type Page } from "@playwright/test";

export const db = new PrismaClient();

export const SEEDED = {
  admin: "+2348030000001",
  ops: "+2348030000002",
  finance: "+2348030000003",
  customer: "+2348030000004",
  dropshipper: "+2348030000005",
} as const;

/**
 * Signs in through the real login UI. After the page requests a code, we add a
 * newer challenge with a code we know (hashed exactly as the server does), so
 * no test-only shortcut exists in the app itself.
 */
export async function signIn(page: Page, phone: string, from = "/login") {
  // Specs sign the same seeded people in many times; keep them under the real 5-per-hour limit.
  await db.authChallenge.deleteMany({ where: { target: phone } });
  if (from) await page.goto(from);
  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Code")).toBeVisible();

  const code = "246810";
  await db.authChallenge.create({
    data: {
      channel: "sms",
      target: phone,
      codeHash: createHmac("sha256", process.env.AUTH_SECRET!).update(`${phone}:${code}`).digest("hex"),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });

  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { waitUntil: "commit" });
}

/** Fails if the page scrolls sideways (rule 11). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page should not scroll horizontally").toBeLessThanOrEqual(0);
}
