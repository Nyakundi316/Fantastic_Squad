import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { ALLOCATION_METHOD_LABELS } from "@/lib/allocation-methods";
import { formatDate } from "@/lib/dates";
import { formatExactShare, formatMoneyCode } from "@/lib/money";
import { formatWeight } from "@/lib/weight";
import type { InvoiceView } from "./invoices";

const ink = "#0F1117";
const muted = "#5A6072";
const line = "#E5E7EB";

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: ink, lineHeight: 1.4 },
  brand: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  brandAccent: { color: "#5B3DF5" },
  muted: { color: muted },
  h1: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 24 },
  meta: { flexDirection: "row", gap: 24, marginTop: 12 },
  metaLabel: { color: muted, fontSize: 8, textTransform: "uppercase" },
  table: { marginTop: 20, borderTop: `1pt solid ${line}` },
  row: { flexDirection: "row", borderBottom: `1pt solid ${line}`, paddingVertical: 6 },
  head: { color: muted, fontSize: 8, textTransform: "uppercase" },
  cellWide: { flex: 3 },
  cell: { flex: 1, textAlign: "right" },
  total: { flexDirection: "row", justifyContent: "flex-end", gap: 24, marginTop: 12, fontSize: 13, fontFamily: "Helvetica-Bold" },
  box: { marginTop: 24, padding: 12, backgroundColor: "#F7F7F9", borderRadius: 4 },
  boxTitle: { fontFamily: "Helvetica-Bold", marginBottom: 4 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 8, color: muted },
});

const STATUS_LABEL = { issued: "Unpaid", paid: "Paid", voided: "Voided", adjusted: "Replaced by a newer version" } as const;

function InvoiceDocument({ view }: { view: InvoiceView }) {
  const money = (v: string) => formatMoneyCode(v, view.currency);
  const title = view.kind === "shipping" ? "Shipping invoice" : "Product invoice";

  return (
    <Document title={`${title} ${view.order.orderNumber}`} author="FANTASTICZONE">
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>
          FANTASTIC<Text style={s.brandAccent}>ZONE</Text>
        </Text>
        <Text style={s.muted}>Shop Smart. Save More.</Text>

        <Text style={s.h1}>
          {title} {view.version > 1 ? `(version ${view.version})` : ""}
        </Text>
        <View style={s.meta}>
          <View>
            <Text style={s.metaLabel}>Order</Text>
            <Text>{view.order.orderNumber}</Text>
          </View>
          <View>
            <Text style={s.metaLabel}>Issued</Text>
            <Text>{formatDate(view.issuedAt)}</Text>
          </View>
          {view.dueAt && (
            <View>
              <Text style={s.metaLabel}>Due</Text>
              <Text>{formatDate(view.dueAt)}</Text>
            </View>
          )}
          <View>
            <Text style={s.metaLabel}>Status</Text>
            <Text>
              {STATUS_LABEL[view.status]}
              {view.paidAt ? ` ${formatDate(view.paidAt)}` : ""}
            </Text>
          </View>
          <View>
            <Text style={s.metaLabel}>Billed to</Text>
            <Text>{view.order.shipAddress?.fullName ?? view.order.user.name ?? view.order.user.phone}</Text>
          </View>
        </View>

        {view.kind === "product" ? (
          <>
            <View style={s.table}>
              <View style={[s.row, s.head]}>
                <Text style={s.cellWide}>Item</Text>
                <Text style={s.cell}>Qty</Text>
                <Text style={s.cell}>Unit price</Text>
                <Text style={s.cell}>Line total</Text>
              </View>
              {view.product.lines.map((l, i) => (
                <View key={i} style={s.row}>
                  <Text style={s.cellWide}>
                    {l.title} ({l.variant})
                  </Text>
                  <Text style={s.cell}>{l.quantity}</Text>
                  <Text style={s.cell}>{money(l.unitPrice)}</Text>
                  <Text style={s.cell}>{money(l.lineTotal)}</Text>
                </View>
              ))}
            </View>
            <View style={s.total}>
              <Text>Total</Text>
              <Text>{money(view.amount)}</Text>
            </View>
            <View style={s.box}>
              <Text>Product price only. Shipping is separate and is invoiced after your items are measured in China.</Text>
            </View>
          </>
        ) : (
          <>
            <View style={s.table}>
              <View style={[s.row, s.head]}>
                <Text style={s.cellWide}>Item</Text>
                <Text style={s.cell}>Qty</Text>
                <Text style={s.cell}>Weight share</Text>
                <Text style={s.cell}>Your cost</Text>
              </View>
              {view.items.map((item, i) => (
                <View key={i} style={s.row}>
                  <Text style={s.cellWide}>
                    {item.title} ({item.variant})
                  </Text>
                  <Text style={s.cell}>{item.quantity}</Text>
                  <Text style={s.cell}>
                    {formatWeight(item.lineChargeableG)} ({item.weightSharePercent}%)
                  </Text>
                  <Text style={s.cell}>{money(item.cost)}</Text>
                </View>
              ))}
            </View>
            <View style={s.total}>
              <Text>Shipping total</Text>
              <Text>{money(view.amount)}</Text>
            </View>
            <View style={s.box}>
              <Text style={s.boxTitle}>How this was calculated</Text>
              <Text>
                {view.shipping.batch.name} ({view.shipping.shipMethod} freight) was quoted {money(view.shipping.batchQuote)} for{" "}
                {formatWeight(view.shipping.totalBatchWeightG)} of chargeable weight across {view.shipping.orderCount} orders.
              </Text>
              <Text>Split method: {ALLOCATION_METHOD_LABELS[view.shipping.method]}.</Text>
              {view.shipping.volumetricDivisor && (
                <Text>
                  Each item is charged at the greater of its actual weight and its volumetric weight (L × W × H in mm ÷ {view.shipping.volumetricDivisor}).
                </Text>
              )}
              <Text>
                Your share: {view.shipping.formula} = {formatExactShare(view.shipping.exactShare)}, rounded to {money(view.shipping.amount)}
                {view.shipping.residualApplied ? ` (includes ${view.shipping.residualApplied} rounding so the batch total matches the quote)` : ""}.
              </Text>
              {view.adjustment && (
                <Text>
                  Adjusted from {money(view.adjustment.previousAmount)} (version {view.adjustment.previousVersion}): {view.adjustment.reason}
                </Text>
              )}
            </View>
          </>
        )}

        <Text style={s.footer} fixed>
          FANTASTICZONE · {view.order.orderNumber} · Reference this order number when paying by bank transfer.
        </Text>
      </Page>
    </Document>
  );
}

export function renderInvoicePdf(view: InvoiceView): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument view={view} />);
}
