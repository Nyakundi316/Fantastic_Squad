import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatMoneyCode } from "@/lib/money";
import { verifyPaystackSignature } from "@/server/payments/paystack";

describe("verifyPaystackSignature", () => {
  const secret = "sk_test_abc";
  const body = JSON.stringify({ event: "charge.success", data: { reference: "FZ-1001-S1-aa" } });
  const good = createHmac("sha512", secret).update(body).digest("hex");

  it("accepts the HMAC-SHA512 of the exact raw body", () => {
    expect(verifyPaystackSignature(body, good, secret)).toBe(true);
    expect(verifyPaystackSignature(body, good.toUpperCase(), secret)).toBe(true);
  });

  it("rejects tampering, the wrong key and malformed headers", () => {
    expect(verifyPaystackSignature(body.replace("1001", "1002"), good, secret)).toBe(false);
    expect(verifyPaystackSignature(body, good, "sk_test_other")).toBe(false);
    expect(verifyPaystackSignature(body, null, secret)).toBe(false);
    expect(verifyPaystackSignature(body, good.slice(0, 64), secret)).toBe(false);
    expect(verifyPaystackSignature(body, "z".repeat(128), secret)).toBe(false);
  });
});

describe("formatMoneyCode", () => {
  it.each([
    ["0", "NGN 0.00"],
    ["999.5", "NGN 999.50"],
    ["1250000", "NGN 1,250,000.00"],
    ["-4500.25", "NGN -4,500.25"],
  ])("%s → %s", (input, expected) => {
    expect(formatMoneyCode(input)).toBe(expected);
  });
});

describe("formatExactShare", async () => {
  const { formatExactShare } = await import("@/lib/money");
  it("cuts long shares to 4 dp with an ellipsis and leaves short ones alone", () => {
    expect(formatExactShare("7029.1851768542990496")).toBe("7029.1851…");
    expect(formatExactShare("4800")).toBe("4800");
    expect(formatExactShare("12.5")).toBe("12.5");
  });
});
