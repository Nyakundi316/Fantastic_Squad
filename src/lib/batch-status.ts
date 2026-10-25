import type { BatchStatus } from "@prisma/client";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

export const BATCH_STATUS: Record<BatchStatus, { label: string; tone: Tone }> = {
  collecting: { label: "Collecting", tone: "accent" },
  ordered: { label: "Ordered", tone: "info" },
  measured: { label: "Measured", tone: "info" },
  invoiced: { label: "Invoiced", tone: "warning" },
  shipped: { label: "Shipped", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Stepper and kanban order. */
export const BATCH_FLOW = ["collecting", "ordered", "measured", "invoiced", "shipped", "delivered"] as const satisfies readonly BatchStatus[];

/** Transitions ops trigger by hand. Invoiced, shipped and delivered come from allocation approval and shipments. */
export const MANUAL_TRANSITIONS: Partial<Record<BatchStatus, BatchStatus[]>> = {
  collecting: ["ordered", "cancelled"],
  ordered: ["measured"],
};

export function canTransition(from: BatchStatus, to: BatchStatus): boolean {
  return MANUAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Measurements can be entered once goods are bought and until shipping invoices go out. */
export const MEASURABLE_STATUSES: readonly BatchStatus[] = ["ordered", "measured"];
