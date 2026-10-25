import { csvResponse, toCsv } from "@/lib/csv";
import { requireApiUser } from "@/server/auth/api-user";
import { route } from "@/server/http";
import { listAdminOrders, parseAdminOrderFilters, productPaymentState } from "@/server/orders/admin-list";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  await requireApiUser(req, "admin.view");
  const filters = parseAdminOrderFilters((key) => req.nextUrl.searchParams.get(key));
  const { rows } = await listAdminOrders(filters, { all: true });

  const csv = toCsv(
    [
      "order_number", "created_at", "status", "customer_name", "customer_phone", "customer_email", "batch",
      "ship_method", "items", "product_total", "product_payment", "shipping_total", "grand_total",
    ],
    rows.map((o) => [
      o.orderNumber,
      o.createdAt.toISOString(),
      o.status,
      o.user.name,
      o.user.phone,
      o.user.email,
      o.batch?.name,
      o.shipMethod,
      o._count.items,
      o.productTotal.toFixed(2),
      productPaymentState(o),
      o.shippingTotal.toFixed(2),
      o.grandTotal.toFixed(2),
    ]),
  );

  return csvResponse(`orders-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});
