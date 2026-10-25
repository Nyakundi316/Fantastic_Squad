import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { formatMoney, toMoneyString } from "@/lib/money";

describe("toMoneyString", () => {
  it("always returns two decimal places", () => {
    expect(toMoneyString("18500")).toBe("18500.00");
    expect(toMoneyString("18500.5")).toBe("18500.50");
    expect(toMoneyString(new Prisma.Decimal("0.1").add("0.2"))).toBe("0.30");
  });

  it("rejects strings that are not money", () => {
    expect(() => toMoneyString("12.345")).toThrow();
    expect(() => toMoneyString("1e5")).toThrow();
  });
});

describe("formatMoney", () => {
  it("formats naira with symbol and 2 dp", () => {
    expect(formatMoney("18500")).toBe("₦18,500.00");
    expect(formatMoney(new Prisma.Decimal("1234567.8"))).toBe("₦1,234,567.80");
  });

  it("does not lose precision on large values", () => {
    expect(formatMoney("9999999999.99")).toBe("₦9,999,999,999.99");
  });
});
