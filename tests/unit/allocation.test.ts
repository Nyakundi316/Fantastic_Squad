import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  ALLOCATION_ALGORITHM_VERSION,
  AllocationError,
  allocateShipping,
  volumetricGrams,
  type AllocationInput,
  type AllocationMethod,
  type MeasurementInput,
} from "@/server/allocation/allocate";

const weighed = (weightG: number, dims?: [number | null, number | null, number | null]): MeasurementInput => ({
  weightG,
  lengthMm: dims?.[0] ?? null,
  widthMm: dims?.[1] ?? null,
  heightMm: dims?.[2] ?? null,
});

type ItemSpec = { qty?: number; m: MeasurementInput | null };

function batch(method: AllocationMethod | null, quote: AllocationInput["quote"], orders: ItemSpec[][], divisor = 5000): AllocationInput {
  return {
    method,
    quote,
    volumetricDivisor: divisor,
    orders: orders.map((items, o) => ({
      orderId: `order-${o + 1}`,
      items: items.map((item, i) => ({ orderItemId: `item-${o + 1}-${i + 1}`, quantity: item.qty ?? 1, measurement: item.m })),
    })),
  };
}

const amounts = (input: AllocationInput) => allocateShipping(input).orders.map((o) => o.allocatedAmount);

function expectError(input: AllocationInput, code: string) {
  try {
    allocateShipping(input);
  } catch (err) {
    expect(err).toBeInstanceOf(AllocationError);
    expect((err as AllocationError).code).toBe(code);
    return err as AllocationError;
  }
  throw new Error(`expected AllocationError ${code}`);
}

const sum = (values: string[]) => values.reduce((s, v) => s.add(v), new Prisma.Decimal(0)).toFixed(2);

describe("weight", () => {
  it("splits three orders by weight and gives the residual cent to the largest fractional remainder", () => {
    // 100.00 × 2/9, 3/9, 4/9 = 22.222…, 33.333…, 44.444… → 22.22 + 33.33 + 44.44 = 99.99, residual 0.01
    const input = batch("weight", "100.00", [[{ m: weighed(2) }], [{ m: weighed(3) }], [{ m: weighed(4) }]]);
    const result = allocateShipping(input);

    expect(result.orders.map((o) => o.allocatedAmount)).toEqual(["22.22", "33.33", "44.45"]);
    expect(result.orders.map((o) => o.residualApplied)).toEqual([null, null, "0.01"]);
    expect(sum(result.orders.map((o) => o.allocatedAmount))).toBe("100.00");
    expect(result).toMatchObject({ version: ALLOCATION_ALGORITHM_VERSION, method: "weight", quote: "100.00", totalChargeableWeightG: 9, orderCount: 3, volumetricDivisor: null });
    expect(result.orders[0]!.exactAmount).toMatch(/^22\.2222222/);
  });

  it("weighs every unit: weight per unit × quantity", () => {
    const result = allocateShipping(batch("weight", "1000.00", [[{ qty: 3, m: weighed(500) }, { qty: 1, m: weighed(500) }], [{ qty: 4, m: weighed(250) }]]));
    expect(result.orders.map((o) => o.chargeableWeightG)).toEqual([2000, 1000]);
    expect(result.orders.map((o) => o.allocatedAmount)).toEqual(["666.67", "333.33"]);
    expect(result.orders.map((o) => o.residualApplied)).toEqual([null, null]);
    expect(result.orders[0]!.items[0]).toEqual({ orderItemId: "item-1-1", quantity: 3, weightG: 500, volumetricG: null, chargeableG: 500, lineChargeableG: 1500 });
  });

  it("breaks residual ties in favour of the earliest order", () => {
    expect(amounts(batch("weight", "100.00", [[{ m: weighed(1) }], [{ m: weighed(1) }], [{ m: weighed(1) }]]))).toEqual(["33.34", "33.33", "33.33"]);
  });

  it("takes a negative residual off the largest remainder", () => {
    // 1.00 × 1/6 = 0.1666… each → 0.17 × 6 = 1.02, residual −0.02
    const result = allocateShipping(batch("weight", "1.00", Array.from({ length: 6 }, () => [{ m: weighed(10) }])));
    expect(result.orders.map((o) => o.allocatedAmount)).toEqual(["0.15", "0.17", "0.17", "0.17", "0.17", "0.17"]);
    expect(result.orders[0]!.residualApplied).toBe("-0.02");
  });

  it("allows a zero-gram item as long as the batch has weight", () => {
    expect(amounts(batch("weight", "50.00", [[{ m: weighed(0) }], [{ m: weighed(10) }]]))).toEqual(["0.00", "50.00"]);
  });

  it("rejects a batch whose total weight is zero", () => {
    expectError(batch("weight", "50.00", [[{ m: weighed(0) }], [{ m: weighed(0) }]]), "zero_total_weight");
  });
});

describe("volumetric", () => {
  it("computes volumetric grams as L×W×H ÷ divisor, rounded up", () => {
    expect(volumetricGrams(400, 300, 200, 5000)).toBe(4800); // 40×30×20 cm = 24000 cm³ ÷ 5000 = 4.8 kg
    expect(volumetricGrams(101, 99, 1, 5000)).toBe(2); // 1.9998 g → 2 g
    expect(volumetricGrams(7, 7, 7, 5000)).toBe(1);
    expect(volumetricGrams(100, 100, 100, 5000)).toBe(200);
    expect(volumetricGrams(400, 300, 200, 6000)).toBe(4000);
  });

  it("charges each unit at the greater of actual and volumetric weight", () => {
    // Bulky pillow: 500 g actual, 4800 g volumetric. Dense kettle: 3000 g actual, 200 g volumetric.
    const result = allocateShipping(
      batch("volumetric", "7800.00", [[{ m: weighed(500, [400, 300, 200]) }], [{ m: weighed(3000, [100, 100, 100]) }]]),
    );
    expect(result.orders.map((o) => o.allocatedAmount)).toEqual(["4800.00", "3000.00"]);
    expect(result.orders[0]!.items[0]).toMatchObject({ weightG: 500, volumetricG: 4800, chargeableG: 4800 });
    expect(result.orders[1]!.items[0]).toMatchObject({ weightG: 3000, volumetricG: 200, chargeableG: 3000 });
    expect(result.orders.map((o) => o.actualWeightG)).toEqual([500, 3000]);
    expect(result).toMatchObject({ totalChargeableWeightG: 7800, volumetricDivisor: 5000 });
  });

  it("uses the divisor from settings, not a hardcoded 5000", () => {
    const result = allocateShipping(batch("volumetric", "8000.00", [[{ m: weighed(500, [400, 300, 200]) }], [{ m: weighed(4000, [10, 10, 10]) }]], 6000));
    expect(result.orders.map((o) => o.chargeableWeightG)).toEqual([4000, 4000]);
    expect(result.volumetricDivisor).toBe(6000);
  });

  it.each([
    ["length", [null, 100, 100]],
    ["width", [100, null, 100]],
    ["height", [100, 100, null]],
    ["a zero dimension", [100, 0, 100]],
  ] as const)("rejects an item missing %s", (_label, dims) => {
    const err = expectError(batch("volumetric", "100.00", [[{ m: weighed(100, [...dims]) }], [{ m: weighed(100, [1, 1, 1]) }]]), "dimensions_missing");
    expect(err.message).toBe("1 item needs length, width and height for a volumetric split.");
    expect(err.details.orderItemIds).toEqual(["item-1-1"]);
  });

  it("counts every item without dimensions", () => {
    const err = expectError(batch("volumetric", "100.00", [[{ m: weighed(100) }, { m: weighed(100) }]]), "dimensions_missing");
    expect(err.message).toBe("2 items need length, width and height for a volumetric split.");
  });

  it.each([0, -5000, 1.5])("rejects a divisor of %s", (divisor) => {
    expectError(batch("volumetric", "100.00", [[{ m: weighed(100, [1, 1, 1]) }]], divisor), "invalid_divisor");
  });

  it("ignores the divisor for non-volumetric methods", () => {
    expect(amounts(batch("weight", "10.00", [[{ m: weighed(5) }]], 0))).toEqual(["10.00"]);
  });
});

describe("quantity", () => {
  it("splits by units across orders", () => {
    const result = allocateShipping(
      batch("quantity", "900.00", [[{ m: weighed(5000) }], [{ qty: 2, m: weighed(1) }], [{ qty: 3, m: weighed(1) }, { qty: 3, m: weighed(1) }]]),
    );
    expect(result.orders.map((o) => o.allocatedAmount)).toEqual(["100.00", "200.00", "600.00"]);
    expect(result.totalUnits).toBe(9);
  });

  it("does not need weight", () => {
    expect(amounts(batch("quantity", "10.00", [[{ m: weighed(0) }], [{ m: weighed(0) }]]))).toEqual(["5.00", "5.00"]);
  });
});

describe("equal", () => {
  it("splits a non-divisible quote and still sums to the quote", () => {
    const result = allocateShipping(batch("equal", "100.00", [[{ m: weighed(1) }], [{ m: weighed(900) }], [{ m: weighed(5) }]]));
    expect(result.orders.map((o) => o.allocatedAmount)).toEqual(["33.34", "33.33", "33.33"]);
    expect(sum(result.orders.map((o) => o.allocatedAmount))).toBe("100.00");
  });

  it("works with zero-weight items (total weight check does not apply)", () => {
    expect(amounts(batch("equal", "7.00", [[{ m: weighed(0) }], [{ m: weighed(0) }]]))).toEqual(["3.50", "3.50"]);
  });

  it("refuses when the quote is too small to give everyone a non-negative share", () => {
    // 0.04 ÷ 7 = 0.0057… → 0.01 × 7 = 0.07, residual −0.03 would push one order to −0.02
    expectError(batch("equal", "0.04", Array.from({ length: 7 }, () => [{ m: weighed(1) }])), "negative_allocation");
  });
});

describe("Σ allocations = quote, always", () => {
  // Deterministic pseudo-random batches across every method.
  function rng(seed: number) {
    return () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }

  it("holds for 500 random batches", () => {
    const rand = rng(42);
    const methods: AllocationMethod[] = ["weight", "volumetric", "quantity", "equal"];
    for (let run = 0; run < 500; run++) {
      const method = methods[run % 4]!;
      const orderCount = 1 + Math.floor(rand() * 40);
      const quote = new Prisma.Decimal(Math.floor(rand() * 5_000_000_00) + 1).div(100).toFixed(2);
      const orders = Array.from({ length: orderCount }, () =>
        Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({
          qty: 1 + Math.floor(rand() * 12),
          m: weighed(1 + Math.floor(rand() * 20_000), [1 + Math.floor(rand() * 900), 1 + Math.floor(rand() * 900), 1 + Math.floor(rand() * 900)]),
        })),
      );
      const result = allocateShipping(batch(method, quote, orders));
      const allocated = result.orders.map((o) => o.allocatedAmount);
      expect(sum(allocated), `${method} run ${run}`).toBe(quote);
      expect(allocated.every((a) => /^\d+\.\d{2}$/.test(a))).toBe(true);
      expect(result.orders.filter((o) => o.residualApplied !== null).length).toBeLessThanOrEqual(1);
    }
  });

  it("handles a large quote at full precision", () => {
    const result = allocateShipping(batch("weight", "9999999999.99", [[{ m: weighed(1) }], [{ m: weighed(2) }], [{ m: weighed(999_999) }]]));
    expect(sum(result.orders.map((o) => o.allocatedAmount))).toBe("9999999999.99");
  });
});

describe("validation", () => {
  const good = [[{ m: weighed(100) }]];

  it("rejects missing measurements and says how many", () => {
    const one = expectError(batch("weight", "100.00", [[{ m: weighed(100) }, { m: null }]]), "measurements_missing");
    expect(one.message).toBe("1 item is not measured yet.");
    expect(one.details.orderItemIds).toEqual(["item-1-2"]);

    const two = expectError(batch("equal", "100.00", [[{ m: null }], [{ m: null }]]), "measurements_missing");
    expect(two.message).toBe("2 items are not measured yet.");
  });

  it.each(["0", "0.00", "-1", "-0.01"])("rejects a quote of %s", (quote) => {
    expectError(batch("weight", quote, good), "quote_not_positive");
  });

  it.each([null, ""])("rejects a missing quote (%j)", (quote) => {
    expectError(batch("weight", quote, good), "quote_missing");
  });

  it.each(["abc", "Infinity", "NaN", "1.234"])("rejects a malformed quote %s", (quote) => {
    expectError(batch("weight", quote, good), "quote_invalid");
  });

  it("accepts a Prisma.Decimal quote", () => {
    expect(amounts(batch("weight", new Prisma.Decimal("12.5"), good))).toEqual(["12.50"]);
  });

  it("requires a method, orders, items and sane numbers", () => {
    expectError(batch(null, "100.00", good), "method_missing");
    expectError(batch("weight", "100.00", []), "no_orders");
    expectError(batch("weight", "100.00", [[]]), "empty_order");
    expectError(batch("weight", "100.00", [[{ qty: 0, m: weighed(1) }]]), "invalid_quantity");
    expectError(batch("weight", "100.00", [[{ qty: 1.5, m: weighed(1) }]]), "invalid_quantity");
    expectError(batch("weight", "100.00", [[{ m: weighed(-1) }]]), "invalid_measurement");
    expectError(batch("weight", "100.00", [[{ m: weighed(2.5) }]]), "invalid_measurement");
    expectError(batch("weight", "100.00", [[{ m: { ...weighed(1), weightG: "100" as unknown as number } }]]), "invalid_measurement");
  });
});
