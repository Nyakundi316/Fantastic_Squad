import Link from "next/link";
import type { ShipmentStatus } from "@prisma/client";
import { ShipMethodBadge } from "@/components/orders/order-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireStaffViewer } from "@/server/auth/viewer";
import { CreateShipmentForm, EditShipmentDetails, ReleaseOrderButton, ShipmentStepButton } from "./shipment-controls";

export const metadata = { title: "Shipments" };

const FLOW: ShipmentStatus[] = ["pending", "in_transit", "arrived", "delivered"];
const LABEL: Record<ShipmentStatus, string> = { pending: "Booked", in_transit: "In transit", arrived: "Arrived", delivered: "Delivered" };

export default async function ShipmentsPage() {
  const staff = await requireStaffViewer("/admin/shipments");
  const canWrite = can(staff.role, "shipments.write");

  const [readyBatches, shipments, held] = await Promise.all([
    db.batch.findMany({ where: { status: "invoiced", shipments: { none: {} } }, orderBy: { cutoffAt: "asc" } }),
    db.shipment.findMany({
      orderBy: [{ deliveredAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      take: 50,
      include: { batch: { include: { orders: { where: { status: { not: "cancelled" } }, select: { status: true } } } } },
    }),
    db.order.findMany({
      where: { OR: [{ status: "invoiced", batch: { status: { in: ["shipped", "delivered"] } } }, { status: "shipped", batch: { status: "delivered" } }] },
      include: { user: { select: { name: true, phone: true } }, batch: { select: { name: true } } },
      orderBy: { orderNumber: "asc" },
    }),
  ]);

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold">Shipments</h1>

      {readyBatches.length > 0 && (
        <section className="mt-6">
          <h2 className="text-base font-semibold">Ready to book</h2>
          <div className="mt-3 space-y-3">
            {readyBatches.map((batch) => (
              <Card key={batch.id} className="p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Link href={`/admin/batches/${batch.id}`} className="font-medium text-primary hover:underline">
                    {batch.name}
                  </Link>
                  <ShipMethodBadge method={batch.defaultShipMethod} />
                </div>
                {canWrite ? (
                  <CreateShipmentForm batchId={batch.id} defaultEta={batch.defaultShipMethod === "air" ? 10 : 40} />
                ) : (
                  <p className="text-sm text-muted-foreground">Waiting for ops to book the shipment.</p>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-base font-semibold">All shipments</h2>
        {shipments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing booked yet. Batches appear above once their shipping invoices are sent.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {shipments.map((shipment) => {
              const paid = shipment.batch.orders.filter((o) => o.status === "shipping_paid").length;
              const unpaid = shipment.batch.orders.filter((o) => o.status === "invoiced").length;
              const current = FLOW.indexOf(shipment.status);
              const warning =
                shipment.status === "pending"
                  ? `${paid} paid ${paid === 1 ? "order ships" : "orders ship"} and customers are told by WhatsApp and email. ${unpaid} unpaid ${unpaid === 1 ? "order travels" : "orders travel"} with the batch but ${unpaid === 1 ? "is" : "are"} held at the destination until paid.`
                  : undefined;
              return (
                <li key={shipment.id}>
                  <Card className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/admin/batches/${shipment.batchId}`} className="font-medium text-primary hover:underline">
                            {shipment.batch.name}
                          </Link>
                          <ShipMethodBadge method={shipment.method} />
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {shipment.carrier ?? "Carrier not set"} · {shipment.trackingNumber ?? "no tracking number"}
                          {shipment.estimatedDays && ` · ETA ${shipment.estimatedDays} days`}
                          {shipment.departedAt && ` · left ${formatDate(shipment.departedAt)}`}
                          {shipment.deliveredAt && ` · delivered ${formatDate(shipment.deliveredAt)}`}
                        </p>
                      </div>
                      {canWrite && <ShipmentStepButton shipmentId={shipment.id} status={shipment.status} warning={warning} />}
                    </div>
                    <ol className="mt-4 flex flex-wrap gap-2 text-xs" aria-label="Shipment progress">
                      {FLOW.map((step, i) => (
                        <li
                          key={step}
                          aria-current={i === current ? "step" : undefined}
                          className={cn(
                            "rounded-full px-2.5 py-1",
                            i < current && "bg-success-soft text-success",
                            i === current && "bg-primary text-white",
                            i > current && "bg-muted text-muted-foreground",
                          )}
                        >
                          {LABEL[step]}
                        </li>
                      ))}
                    </ol>
                    {canWrite && shipment.status !== "delivered" && (
                      <EditShipmentDetails
                        shipmentId={shipment.id}
                        initial={{
                          carrier: shipment.carrier ?? "",
                          trackingNumber: shipment.trackingNumber ?? "",
                          estimatedDays: shipment.estimatedDays?.toString() ?? "",
                        }}
                      />
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-base font-semibold">Held at destination</h2>
        <p className="mt-1 text-sm text-muted-foreground">Orders that travelled with their batch but are released only once shipping is paid.</p>
        {held.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface text-sm">
            {held.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span>
                  <Link href={`/admin/orders/${order.id}`} className="tabular font-medium text-primary hover:underline">
                    {order.orderNumber}
                  </Link>
                  <span className="text-muted-foreground">
                    {" "}
                    · {order.user.name ?? order.user.phone} · {order.batch?.name}
                  </span>
                </span>
                {order.status === "invoiced" ? (
                  <span className="flex items-center gap-2">
                    <span className="tabular text-muted-foreground">{formatMoney(order.shippingTotal)} due</span>
                    <Badge tone="warning">Awaiting payment</Badge>
                  </span>
                ) : canWrite ? (
                  <ReleaseOrderButton orderId={order.id} />
                ) : (
                  <Badge tone="success">Paid, ready to release</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
