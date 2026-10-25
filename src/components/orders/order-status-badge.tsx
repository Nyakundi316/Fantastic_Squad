import type { OrderStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS } from "@/lib/order-status";

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const { label, tone } = ORDER_STATUS[status];
  return (
    <Badge tone={tone} className={className}>
      {label}
    </Badge>
  );
}

export function ShipMethodBadge({ method }: { method: "sea" | "air" }) {
  return <Badge tone="info">{method === "sea" ? "Sea" : "Air"}</Badge>;
}
