// Display helpers only. Arithmetic on money happens server-side with Prisma.Decimal.

type DecimalLike = { toFixed(dp: number): string };

/** API representation of money: a string with exactly 2 decimal places. */
export function toMoneyString(value: DecimalLike | string): string {
  if (typeof value === "string") {
    if (!/^-?\d+(\.\d{1,2})?$/.test(value)) throw new Error(`Not a money string: ${value}`);
    const [whole, frac = ""] = value.split(".");
    return `${whole}.${frac.padEnd(2, "0")}`;
  }
  return value.toFixed(2);
}

const formatters = new Map<string, Intl.NumberFormat>();

/** "18500.00" → "NGN 18,500.00", for places without the ₦ glyph (PDF base fonts). */
export function formatMoneyCode(amount: string | DecimalLike, currency = "NGN"): string {
  const [whole, frac] = toMoneyString(amount).split(".");
  const negative = whole!.startsWith("-");
  const digits = (negative ? whole!.slice(1) : whole!).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${negative ? "-" : ""}${digits}.${frac}`;
}

/** "18500.00" → "₦18,500.00". Formats the decimal string directly, never via a float. */
export function formatMoney(amount: string | DecimalLike, currency = "NGN"): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatters.set(currency, formatter);
  }
  return formatter.format(toMoneyString(amount) as Intl.StringNumericLiteral);
}

/** Full-precision shares are stored for audit; show 4 decimal places, with an ellipsis when cut. */
export function formatExactShare(value: string): string {
  const [whole, frac = ""] = value.split(".");
  return frac.length > 4 ? `${whole}.${frac.slice(0, 4)}…` : value;
}
