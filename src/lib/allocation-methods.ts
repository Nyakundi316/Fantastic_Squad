import type { AllocationMethod } from "@prisma/client";

export const ALLOCATION_METHOD_LABELS: Record<AllocationMethod, string> = {
  weight: "By weight",
  volumetric: "By weight or volume, whichever is greater",
  quantity: "By number of units",
  equal: "Equally per order",
};
