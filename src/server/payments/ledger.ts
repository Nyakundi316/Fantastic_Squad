import { Prisma, type PaymentStatus } from "@prisma/client";
import { db } from "@/lib/db";

export type LedgerFilters = {
  status?: PaymentStatus;
  kind?: "product" | "shipping";
  method?: "card" | "bank_transfer" | "manual";
  from?: Date;
  to?: Date;
  q?: string;
  page: number;
};

export const LEDGER_PAGE_SIZE = 50;
const STATUSES: PaymentStatus[] = ["pending", "success", "failed", "refunded"];

export function parseLedgerFilters(get: (k: string) => string | null | undefined): LedgerFilters {
  const date = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00+01:00`) : undefined);
  const status = get("status");
  const kind = get("kind");
  const method = get("method");
  const to = date(get("to"));
  return {
    status: STATUSES.includes(status as PaymentStatus) ? (status as PaymentStatus) : undefined,
    kind: kind === "product" || kind === "shipping" ? kind : undefined,
    method: method === "card" || method === "bank_transfer" || method === "manual" ? method : undefined,
    from: date(get("from")),
    // "to" is inclusive of the whole day in Lagos.
    to: to ? new Date(to.getTime() + 86_400_000) : undefined,
    q: get("q")?.trim().slice(0, 60) || undefined,
    page: Math.max(1, Number(get("page")) || 1),
  };
}

export function ledgerWhere(f: LedgerFilters): Prisma.PaymentWhereInput {
  return {
    ...(f.status ? { status: f.status } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.method ? { method: f.method } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.q
      ? { OR: [{ order: { orderNumber: { contains: f.q, mode: "insensitive" } } }, { providerRef: { contains: f.q, mode: "insensitive" } }] }
      : {}),
  };
}

export async function listLedger(f: LedgerFilters, opts: { all?: boolean } = {}) {
  const where = ledgerWhere(f);
  const [rows, total, received] = await Promise.all([
    db.payment.findMany({
      where,
      include: { order: { select: { id: true, orderNumber: true, user: { select: { name: true, phone: true } } } }, invoice: { select: { version: true } } },
      orderBy: { createdAt: "desc" },
      take: opts.all ? 50_000 : LEDGER_PAGE_SIZE,
      skip: opts.all ? 0 : (f.page - 1) * LEDGER_PAGE_SIZE,
    }),
    db.payment.count({ where }),
    db.payment.aggregate({ where: { ...where, status: "success" }, _sum: { amount: true } }),
  ]);
  return { rows, total, received: (received._sum.amount ?? new Prisma.Decimal(0)).toFixed(2) };
}
