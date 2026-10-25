import type { BatchStatus } from "@prisma/client";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BATCH_FLOW, BATCH_STATUS } from "@/lib/batch-status";
import { cn } from "@/lib/utils";

export function BatchStatusBadge({ status, unallocated }: { status: BatchStatus; unallocated?: boolean }) {
  if (unallocated) return <Badge tone="danger">Unallocated</Badge>;
  return <Badge tone={BATCH_STATUS[status].tone}>{BATCH_STATUS[status].label}</Badge>;
}

export function BatchStepper({ status }: { status: BatchStatus }) {
  if (status === "cancelled") return <p className="text-sm text-muted-foreground">This batch was cancelled.</p>;
  const current = BATCH_FLOW.indexOf(status as (typeof BATCH_FLOW)[number]);

  return (
    <ol className="flex items-center gap-1 overflow-x-auto text-sm [scrollbar-width:none]" aria-label="Batch stage">
      {BATCH_FLOW.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step} className="flex shrink-0 items-center gap-1" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1",
                active && "bg-primary text-white",
                done && "text-foreground",
                !active && !done && "text-muted-foreground",
              )}
            >
              {done && <Check className="size-3.5 text-success" aria-hidden />}
              {BATCH_STATUS[step].label}
            </span>
            {i < BATCH_FLOW.length - 1 && <span className={cn("h-px w-4 sm:w-6", done ? "bg-foreground/40" : "bg-border")} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
