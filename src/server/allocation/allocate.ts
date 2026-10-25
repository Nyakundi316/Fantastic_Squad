// Shipping allocation (spec §5). Pure and deterministic: no database, no clock.
// Release gate: 100% unit-test coverage (hard rule 10).

import { Prisma } from "@prisma/client";

export const ALLOCATION_ALGORITHM_VERSION = "fz-alloc-1";

// Enough precision that quote × grams ÷ total grams never loses a cent before the 2 dp rounding.
const Dec = Prisma.Decimal.clone({ precision: 50, rounding: Prisma.Decimal.ROUND_HALF_UP });
type Dec = Prisma.Decimal;

export type AllocationMethod = "weight" | "volumetric" | "quantity" | "equal";

export type MeasurementInput = { weightG: number; lengthMm: number | null; widthMm: number | null; heightMm: number | null };

export type AllocationInput = {
  quote: string | Prisma.Decimal | null;
  method: AllocationMethod | null;
  volumetricDivisor: number;
  /** Caller supplies a stable order (e.g. by order number); it decides residual ties. */
  orders: Array<{
    orderId: string;
    items: Array<{ orderItemId: string; quantity: number; measurement: MeasurementInput | null }>;
  }>;
};

export type AllocatedItem = {
  orderItemId: string;
  quantity: number;
  weightG: number;
  /** Per unit, rounded up to the gram. Null unless the method is volumetric. */
  volumetricG: number | null;
  /** Per unit: max(weight, volumetric) for volumetric, otherwise the weight. */
  chargeableG: number;
  lineChargeableG: number;
};

export type AllocatedOrder = {
  orderId: string;
  units: number;
  actualWeightG: number;
  chargeableWeightG: number;
  items: AllocatedItem[];
  /** Full-precision share before rounding. */
  exactAmount: string;
  /** Final amount, 2 dp. Sums with the others to the quote exactly. */
  allocatedAmount: string;
  /** Non-null on the one order that absorbed the rounding residual. */
  residualApplied: string | null;
};

export type AllocationResult = {
  version: typeof ALLOCATION_ALGORITHM_VERSION;
  method: AllocationMethod;
  quote: string;
  volumetricDivisor: number | null;
  totalChargeableWeightG: number;
  totalUnits: number;
  orderCount: number;
  orders: AllocatedOrder[];
};

export type AllocationErrorCode =
  | "no_orders"
  | "empty_order"
  | "quote_missing"
  | "quote_invalid"
  | "quote_not_positive"
  | "method_missing"
  | "invalid_divisor"
  | "invalid_quantity"
  | "measurements_missing"
  | "invalid_measurement"
  | "dimensions_missing"
  | "zero_total_weight"
  | "negative_allocation";

export class AllocationError extends Error {
  constructor(
    readonly code: AllocationErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const isWholeNumber = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const isPositiveInt = (n: unknown): n is number => isWholeNumber(n) && n > 0;

/**
 * vol_g = (L/10 × W/10 × H/10) ÷ divisor × 1000, which simplifies to L×W×H ÷ divisor
 * with L, W, H in mm. Rounded up to a whole gram, as carriers round chargeable weight up.
 */
export function volumetricGrams(lengthMm: number, widthMm: number, heightMm: number, divisor: number): number {
  const cubicMm = BigInt(lengthMm) * BigInt(widthMm) * BigInt(heightMm);
  const d = BigInt(divisor);
  return Number((cubicMm + d - 1n) / d);
}

function parseQuote(raw: AllocationInput["quote"]): Dec {
  if (raw === null || raw === "") throw new AllocationError("quote_missing", "Enter the batch shipping quote first.");
  let quote: Dec;
  try {
    quote = new Dec(raw.toString());
  } catch {
    throw new AllocationError("quote_invalid", "The shipping quote is not a valid amount.");
  }
  if (!quote.isFinite() || quote.decimalPlaces() > 2) throw new AllocationError("quote_invalid", "The shipping quote must have at most 2 decimal places.");
  if (quote.lte(0)) throw new AllocationError("quote_not_positive", "The shipping quote must be more than 0.");
  return quote;
}

export function allocateShipping(input: AllocationInput): AllocationResult {
  const { method, volumetricDivisor: divisor } = input;
  if (!method) throw new AllocationError("method_missing", "Choose how to split the shipping quote.");
  const quote = parseQuote(input.quote);
  if (input.orders.length === 0) throw new AllocationError("no_orders", "There are no live orders in this batch.");
  if (method === "volumetric" && !isPositiveInt(divisor)) {
    throw new AllocationError("invalid_divisor", "The volumetric divisor in settings must be a whole number above 0.");
  }

  const unmeasured: string[] = [];
  const missingDimensions: string[] = [];

  const orders = input.orders.map((order) => {
    if (order.items.length === 0) throw new AllocationError("empty_order", "An order in this batch has no items.", { orderId: order.orderId });

    const items: AllocatedItem[] = [];
    for (const item of order.items) {
      if (!isPositiveInt(item.quantity)) {
        throw new AllocationError("invalid_quantity", "Item quantities must be whole numbers above 0.", { orderItemId: item.orderItemId });
      }
      const m = item.measurement;
      if (!m) {
        unmeasured.push(item.orderItemId);
        continue;
      }
      // Zero grams is a valid reading here; a batch whose total is zero is rejected below (except for equal splits).
      if (!isWholeNumber(m.weightG)) {
        throw new AllocationError("invalid_measurement", "Weights must be whole grams.", { orderItemId: item.orderItemId });
      }

      let volumetricG: number | null = null;
      if (method === "volumetric") {
        if (!isPositiveInt(m.lengthMm) || !isPositiveInt(m.widthMm) || !isPositiveInt(m.heightMm)) {
          missingDimensions.push(item.orderItemId);
          continue;
        }
        volumetricG = volumetricGrams(m.lengthMm, m.widthMm, m.heightMm, divisor);
      }
      const chargeableG = volumetricG === null ? m.weightG : Math.max(m.weightG, volumetricG);
      items.push({
        orderItemId: item.orderItemId,
        quantity: item.quantity,
        weightG: m.weightG,
        volumetricG,
        chargeableG,
        lineChargeableG: chargeableG * item.quantity,
      });
    }

    return {
      orderId: order.orderId,
      units: order.items.reduce((n, i) => n + i.quantity, 0),
      actualWeightG: items.reduce((g, i) => g + i.weightG * i.quantity, 0),
      chargeableWeightG: items.reduce((g, i) => g + i.lineChargeableG, 0),
      items,
    };
  });

  if (unmeasured.length > 0) {
    throw new AllocationError("measurements_missing", `${unmeasured.length} ${unmeasured.length === 1 ? "item is" : "items are"} not measured yet.`, {
      orderItemIds: unmeasured,
    });
  }
  if (missingDimensions.length > 0) {
    throw new AllocationError(
      "dimensions_missing",
      `${missingDimensions.length} ${missingDimensions.length === 1 ? "item needs" : "items need"} length, width and height for a volumetric split.`,
      { orderItemIds: missingDimensions },
    );
  }

  const totalChargeableWeightG = orders.reduce((g, o) => g + o.chargeableWeightG, 0);
  const totalUnits = orders.reduce((n, o) => n + o.units, 0);
  if ((method === "weight" || method === "volumetric") && totalChargeableWeightG === 0) {
    throw new AllocationError("zero_total_weight", "The batch has no weight to split by.");
  }

  const exact = orders.map((o): Dec => {
    switch (method) {
      case "weight":
      case "volumetric":
        return quote.mul(o.chargeableWeightG).div(totalChargeableWeightG);
      case "quantity":
        return quote.mul(o.units).div(totalUnits);
      case "equal":
        return quote.div(orders.length);
    }
  });

  const rounded = exact.map((e) => e.toDecimalPlaces(2, Dec.ROUND_HALF_UP));
  const residual = quote.sub(rounded.reduce((sum, r) => sum.add(r), new Dec(0)));

  // The whole residual goes to the order with the largest fractional remainder (in cents); earliest wins ties.
  let residualIndex = -1;
  if (!residual.isZero()) {
    let best = new Dec(-1);
    exact.forEach((e, i) => {
      const cents = e.mul(100);
      const remainder = cents.sub(cents.floor());
      if (remainder.gt(best)) {
        best = remainder;
        residualIndex = i;
      }
    });
    rounded[residualIndex] = rounded[residualIndex]!.add(residual);
  }

  if (rounded.some((r) => r.isNegative())) {
    throw new AllocationError("negative_allocation", "The quote is too small to split across this many orders.");
  }

  return {
    version: ALLOCATION_ALGORITHM_VERSION,
    method,
    quote: quote.toFixed(2),
    volumetricDivisor: method === "volumetric" ? divisor : null,
    totalChargeableWeightG,
    totalUnits,
    orderCount: orders.length,
    orders: orders.map((o, i) => ({
      ...o,
      exactAmount: exact[i]!.toString(),
      allocatedAmount: rounded[i]!.toFixed(2),
      residualApplied: i === residualIndex ? residual.toFixed(2) : null,
    })),
  };
}
