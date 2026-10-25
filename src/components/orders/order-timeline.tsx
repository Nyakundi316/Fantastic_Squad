import type { OrderStatus } from "@prisma/client";
import { Check } from "lucide-react";
import { TIMELINE_STEPS, timelineIndex } from "@/lib/order-status";
import { cn } from "@/lib/utils";

/** Placed → Confirmed → Measured → Invoiced → Paid → Shipped → Delivered. Vertical on phones, horizontal from sm. */
export function OrderTimeline({ status }: { status: OrderStatus }) {
  const current = timelineIndex(status);

  if (current === -1) {
    return <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">This order was cancelled.</p>;
  }

  return (
    <ol className="grid gap-0 sm:grid-cols-7" aria-label="Order progress">
      {TIMELINE_STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={step}
            aria-current={active ? "step" : undefined}
            className="relative flex items-center gap-3 pb-4 last:pb-0 sm:flex-col sm:items-start sm:gap-2 sm:pb-0 sm:pr-2"
          >
            {i < TIMELINE_STEPS.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[11px] top-6 h-[calc(100%-24px)] w-px sm:left-6 sm:top-[11px] sm:h-px sm:w-[calc(100%-24px)]",
                  done ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                done && "border-primary bg-primary text-white",
                active && "border-primary bg-surface text-primary ring-4 ring-primary/10",
                !done && !active && "border-border bg-surface text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={cn("text-sm", active ? "font-medium" : done ? "text-foreground" : "text-muted-foreground")}>
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
