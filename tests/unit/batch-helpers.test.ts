import { describe, expect, it } from "vitest";
import { canTransition } from "@/lib/batch-status";
import { parseCsv, toCsv } from "@/lib/csv";
import { formatDimensions, formatWeight } from "@/lib/weight";

describe("formatWeight", () => {
  it.each([
    [0, "0 g"],
    [850, "850 g"],
    [1000, "1.00 kg"],
    [12345, "12.35 kg"],
    [12344, "12.34 kg"],
    [1_234_567, "1,234.57 kg"],
  ])("%i g → %s", (grams, label) => {
    expect(formatWeight(grams)).toBe(label);
  });

  it("refuses non-integer grams", () => {
    expect(() => formatWeight(1.5)).toThrow();
  });

  it("formats dimensions only when all three exist", () => {
    expect(formatDimensions(320, 240, 180)).toBe("320 × 240 × 180 mm");
    expect(formatDimensions(320, null, 180)).toBeNull();
  });
});

describe("CSV", () => {
  it("round-trips quotes, commas and newlines", () => {
    const csv = toCsv(["a", "b"], [["Ada, Okafor", 'say "hi"'], ["line\nbreak", 3]]);
    expect(parseCsv(csv)).toEqual([
      ["a", "b"],
      ["Ada, Okafor", 'say "hi"'],
      ["line\nbreak", "3"],
    ]);
  });

  it("neutralises spreadsheet formulas on export", () => {
    expect(toCsv(["x"], [["=HYPERLINK(1)"], ["+1"], ["@SUM"]])).toBe("x\r\n'=HYPERLINK(1)\r\n'+1\r\n'@SUM\r\n");
  });

  it("handles a BOM, LF endings and blank lines", () => {
    expect(parseCsv("﻿id,weight\n\nabc,450\n")).toEqual([
      ["id", "weight"],
      ["abc", "450"],
    ]);
  });
});

describe("batch transitions", () => {
  it("allows only the manual forward steps", () => {
    expect(canTransition("collecting", "ordered")).toBe(true);
    expect(canTransition("collecting", "cancelled")).toBe(true);
    expect(canTransition("ordered", "measured")).toBe(true);
    expect(canTransition("measured", "invoiced")).toBe(false);
    expect(canTransition("ordered", "collecting")).toBe(false);
    expect(canTransition("delivered", "shipped")).toBe(false);
  });
});
