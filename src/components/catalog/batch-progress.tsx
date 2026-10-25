import { daysUntil } from "@/lib/dates";
import { cn } from "@/lib/utils";

type BatchLike = { name: string; openedAt: Date; cutoffAt: Date; memberCount: number; shipMethod: "sea" | "air" };

/**
 * Real numbers only (rule 8): the bar is time elapsed between the batch opening
 * and its cutoff, and the count is customers with live orders in the batch.
 */
export function BatchProgress({ batch, now = new Date(), className, showName = false }: {
  batch: BatchLike;
  now?: Date;
  className?: string;
  showName?: boolean;
}) {
  const span = batch.cutoffAt.getTime() - batch.openedAt.getTime();
  const elapsed = Math.min(Math.max(now.getTime() - batch.openedAt.getTime(), 0), span);
  const percent = span > 0 ? Math.round((elapsed / span) * 100) : 100;
  const days = daysUntil(batch.cutoffAt, now);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${batch.name}: ${percent}% of the collection window has passed`}
      >
        <div className={cn("h-full rounded-full", days <= 3 ? "bg-warning" : "bg-primary")} style={{ width: `${percent}%` }} />
      </div>
      <p className="tabular flex justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {showName ? `${batch.name} · ` : ""}
          {days === 0 ? "Closes today" : `Closes in ${days} ${days === 1 ? "day" : "days"}`}
        </span>
        <span className="shrink-0">{batch.memberCount} joined</span>
      </p>
    </div>
  );
}
