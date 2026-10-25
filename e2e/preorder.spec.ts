import { expect, test } from "@playwright/test";
import { SEEDED, db, expectNoHorizontalScroll, signIn } from "./support";

test.afterAll(() => db.$disconnect());

test("customer preorders from the catalogue, then finance marks the product invoice paid", async ({ page, browser }, testInfo) => {
  await page.goto("/");
  await expect(page.getByText("Prices shown are product prices only.")).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole("link", { name: /Stainless Steel Rice Cooker/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Stainless Steel Rice Cooker" })).toBeVisible();
  await expect(page.getByText("Shipping is separate and billed later")).toBeVisible();
  await expect(page.getByText("What happens after you order?")).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByText("2.2 L").click();
  await page.getByRole("button", { name: "Increase quantity" }).click();
  await page.getByRole("button", { name: "Join this preorder" }).click();

  // Signed out: checkout sends us to login and back.
  await page.waitForURL(/\/login\?next=%2Fcheckout/);
  await signIn(page, SEEDED.customer, "");
  await page.waitForURL("**/checkout");

  await expect(page.getByText("2.2 L")).toBeVisible();
  await expect(page.getByText("₦56,800.00").first()).toBeVisible(); // 2 × 28,400.00, priced by the server
  await expect(page.getByText("Billed after measurement")).toBeVisible();
  await expectNoHorizontalScroll(page);

  const placeButton = page.getByRole("button", { name: "Place preorder" });
  await expect(placeButton).toBeDisabled();
  await page.getByText("I understand shipping is separate and calculated later.").click();
  await expect(placeButton).toBeEnabled();
  await placeButton.click();

  await page.waitForURL(/\/orders\/[0-9a-f-]{36}\?placed=1/);
  await expect(page.getByRole("status")).toContainText("Preorder placed.");
  const orderNumber = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
  expect(orderNumber).toMatch(/^FZ-\d+$/);
  await expect(page.getByText("Pending").first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto("/orders");
  await expect(page.getByText(orderNumber)).toBeVisible();
  await expectNoHorizontalScroll(page);

  if (testInfo.project.name !== "desktop") return; // the admin half runs once, on desktop

  const financeContext = await browser.newContext();
  const finance = await financeContext.newPage();
  await signIn(finance, SEEDED.finance);
  await finance.waitForURL("**/admin");
  await finance.goto(`/admin/orders?q=${orderNumber}`);
  await finance.getByRole("link", { name: orderNumber }).click();
  await finance.getByRole("button", { name: "Mark paid" }).click();
  await finance.getByLabel("Reference").fill("TRF-E2E-1");
  await finance.getByRole("button", { name: "Confirm payment" }).click();
  await expect(finance.getByText("Paid", { exact: true }).first()).toBeVisible();
  await financeContext.close();

  await page.goto("/orders");
  // The in-app copy of order_received waits in the bell.
  await page.getByRole("button", { name: /^Notifications, \d+ unread$/ }).click();
  await expect(page.getByText("Order confirmed").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible(); // opened, so now read
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: orderNumber }).click();
  await expect(page.getByText(/₦56,800\.00 received/)).toBeVisible();

  const audit = await db.auditLog.findFirst({ where: { action: "payment.marked_paid", after: { path: ["orderNumber"], equals: orderNumber } } });
  expect(audit).not.toBeNull();
});

test("customers cannot open the admin area", async ({ page }) => {
  await signIn(page, SEEDED.customer);
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(403);
  await expect(page.getByText("You do not have access to this page")).toBeVisible();
});
