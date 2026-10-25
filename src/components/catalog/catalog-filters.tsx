import Link from "next/link";
import { cn } from "@/lib/utils";

type Params = Record<string, string | undefined>;

const PRICE_BANDS = [
  { label: "Any price", min: undefined, max: undefined },
  { label: "Under ₦10,000", min: undefined, max: "9999.99" },
  { label: "₦10,000 – ₦25,000", min: "10000", max: "25000" },
  { label: "Over ₦25,000", min: "25000.01", max: undefined },
] as const;

function hrefWith(current: Params, changes: Params) {
  const merged: Params = { ...current, ...changes, page: undefined };
  const query = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => Boolean(e[1])));
  const qs = query.toString();
  return qs ? `/?${qs}#catalog` : "/#catalog";
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-sm transition-colors",
        active ? "border-foreground bg-foreground text-surface" : "border-border bg-surface text-foreground hover:border-foreground/30",
      )}
    >
      {children}
    </Link>
  );
}

export function CatalogFilters({ params, categories }: { params: Params; categories: string[] }) {
  const band = PRICE_BANDS.find((b) => b.min === params.minPrice && b.max === params.maxPrice) ?? PRICE_BANDS[0];

  return (
    <div className="space-y-3">
      <nav aria-label="Categories" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip href={hrefWith(params, { category: undefined })} active={!params.category}>
          All
        </Chip>
        {categories.map((c) => (
          <Chip key={c} href={hrefWith(params, { category: c })} active={params.category === c}>
            {c}
          </Chip>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-1" role="group" aria-label="Ship method">
          <span className="mr-1 text-muted-foreground">Ship by</span>
          {([undefined, "sea", "air"] as const).map((m) => (
            <Link
              key={m ?? "any"}
              href={hrefWith(params, { shipMethod: m })}
              scroll={false}
              aria-current={params.shipMethod === m ? "true" : undefined}
              className={cn(
                "rounded-md px-2 py-1",
                params.shipMethod === m ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === undefined ? "Any" : m === "sea" ? "Sea" : "Air"}
            </Link>
          ))}
        </div>

        <Link
          href={hrefWith(params, { batchClosing: params.batchClosing ? undefined : "7" })}
          scroll={false}
          aria-pressed={Boolean(params.batchClosing)}
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <span
            className={cn(
              "flex size-4 items-center justify-center rounded border",
              params.batchClosing ? "border-primary bg-primary" : "border-border bg-surface",
            )}
            aria-hidden
          >
            {params.batchClosing && <span className="size-1.5 rounded-sm bg-surface" />}
          </span>
          Batch closing within 7 days
        </Link>

        <details className="group relative">
          <summary className="cursor-pointer list-none text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            Price: <span className="font-medium text-foreground">{band.label}</span>
          </summary>
          <div className="absolute left-0 top-7 z-20 w-52 rounded-lg border border-border bg-surface p-1 shadow-pop">
            {PRICE_BANDS.map((b) => (
              <Link
                key={b.label}
                href={hrefWith(params, { minPrice: b.min, maxPrice: b.max })}
                scroll={false}
                className={cn("block rounded-md px-3 py-2 hover:bg-muted", b === band && "font-medium text-primary")}
              >
                {b.label}
              </Link>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
