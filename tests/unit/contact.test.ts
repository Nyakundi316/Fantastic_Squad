import { describe, expect, it } from "vitest";
import { maskPhone, normalizeEmail, normalizePhone } from "@/lib/contact";

describe("normalizePhone", () => {
  it.each([
    ["0803 000 0004", "+2348030000004"],
    ["08030000004", "+2348030000004"],
    ["8030000004", "+2348030000004"],
    ["2348030000004", "+2348030000004"],
    ["+234 (803) 000-0004", "+2348030000004"],
    ["00447700900123", "+447700900123"],
    ["+14155550123", "+14155550123"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "   ", "12345", "0603000000", "+0123456789", "phone"])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lower-cases and trims", () => {
    expect(normalizeEmail("  Ada.Okafor@Example.COM ")).toBe("ada.okafor@example.com");
  });

  it.each(["ada", "ada@", "ada@example", "a b@example.com"])("rejects %j", (input) => {
    expect(normalizeEmail(input)).toBeNull();
  });
});

describe("maskPhone", () => {
  it("keeps the country code and last four digits", () => {
    expect(maskPhone("+2348030000004")).toBe("+234 803 *** 0004");
  });
});
