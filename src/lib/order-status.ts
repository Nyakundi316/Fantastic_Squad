import type { OrderStatus, InvoiceStatus } from "@prisma/client";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  preorder_placed: { label: "Preorder placed", tone: "accent" },
  batch_confirmed: { label: "Batch confirmed", tone: "info" },
  measured: { label: "Measured", tone: "info" },
  invoiced: { label: "Shipping due", tone: "warning" },
  shipping_paid: { label: "Shipping paid", tone: "success" },
  shipped: { label: "Shipped", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  issued: { label: "Pending", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  voided: { label: "Voided", tone: "neutral" },
  adjusted: { label: "Replaced", tone: "neutral" },
};

/** §6 order timeline. */
export const TIMELINE_STEPS = ["Placed", "Confirmed", "Measured", "Invoiced", "Paid", "Shipped", "Delivered"] as const;

const STEP_INDEX: Record<Exclude<OrderStatus, "cancelled">, number> = {
  preorder_placed: 0,
  batch_confirmed: 1,
  measured: 2,
  invoiced: 3,
  shipping_paid: 4,
  shipped: 5,
  delivered: 6,
};

/** Index of the current step, or -1 when cancelled. */
export function timelineIndex(status: OrderStatus): number {
  return status === "cancelled" ? -1 : STEP_INDEX[status];
}

/** One line on order cards saying where shipping stands. Never a final figure before measurement. */
export function shippingStatusLine(status: OrderStatus, shippingDue: string | null): string {
  switch (status) {
    case "preorder_placed":
    case "batch_confirmed":
      return "Shipping billed after measurement";
    case "measured":
      return "Measured, shipping invoice being prepared";
    case "invoiced":
      return shippingDue ? `Shipping due: ${shippingDue}` : "Shipping invoice ready";
    case "shipping_paid":
      return "Shipping paid, waiting to ship";
    case "shipped":
      return "On the way";
    case "delivered":
      return "Delivered";
    case "cancelled":
      return "Cancelled";
  }
}

/** Status filter groups on /orders. */
export const ORDER_FILTERS = {
  all: { label: "All", statuses: null },
  active: { label: "In progress", statuses: ["preorder_placed", "batch_confirmed", "measured"] },
  due: { label: "Shipping due", statuses: ["invoiced"] },
  shipping: { label: "Shipping", statuses: ["shipping_paid", "shipped"] },
  delivered: { label: "Delivered", statuses: ["delivered"] },
  cancelled: { label: "Cancelled", statuses: ["cancelled"] },
} as const satisfies Record<string, { label: string; statuses: readonly OrderStatus[] | null }>;

export type OrderFilterKey = keyof typeof ORDER_FILTERS;

export function isOrderFilterKey(value: unknown): value is OrderFilterKey {
  return typeof value === "string" && value in ORDER_FILTERS;
}
