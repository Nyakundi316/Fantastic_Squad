"use client";

import { useMutation } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ApiError } from "@/lib/api-client";
import { parseCsv, toCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

export type SheetRow = {
  orderItemId: string;
  orderNumber: string;
  customer: string;
  product: string;
  variant: string;
  quantity: number;
  weightG: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
};

type Field = "weightG" | "lengthMm" | "widthMm" | "heightMm";
type Draft = Record<Field, string>;

const FIELDS: Array<{ key: Field; label: string; csv: string }> = [
  { key: "weightG", label: "Weight (g)", csv: "weight_g" },
  { key: "lengthMm", label: "L (mm)", csv: "length_mm" },
  { key: "widthMm", label: "W (mm)", csv: "width_mm" },
  { key: "heightMm", label: "H (mm)", csv: "height_mm" },
];

const toDraft = (r: SheetRow): Draft => ({
  weightG: r.weightG?.toString() ?? "",
  lengthMm: r.lengthMm?.toString() ?? "",
  widthMm: r.widthMm?.toString() ?? "",
  heightMm: r.heightMm?.toString() ?? "",
});

/** Same rules as the server: whole numbers above 0, weight required, all three dimensions or none. */
function validate(d: Draft): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  for (const { key } of FIELDS) {
    const v = d[key].trim();
    if (v && !/^[1-9]\d{0,6}$/.test(v)) errors[key] = "Whole number above 0";
  }
  if (!d.weightG.trim()) errors.weightG = "Required";
  const dims = [d.lengthMm, d.widthMm, d.heightMm].filter((v) => v.trim());
  if (dims.length > 0 && dims.length < 3) {
    for (const key of ["lengthMm", "widthMm", "heightMm"] as const) if (!d[key].trim()) errors[key] ??= "Needs all three";
  }
  return errors;
}

const blankDraft = (d: Draft) => Object.values(d).every((v) => !v.trim());
const intOrNull = (v: string) => (v.trim() ? Number(v.trim()) : null);

export function MeasurementSheet({ batchId, rows, editable, batchName }: { batchId: string; rows: SheetRow[]; editable: boolean; batchName: string }) {
  const router = useRouter();
  const initial = useMemo(() => Object.fromEntries(rows.map((r) => [r.orderItemId, toDraft(r)])), [rows]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initial);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirtyIds = rows
    .map((r) => r.orderItemId)
    .filter((id) => FIELDS.some(({ key }) => drafts[id]![key].trim() !== initial[id]![key]));
  // A dirty row the user blanked out can't be saved (measurements aren't deleted), so it counts as invalid.
  const invalidIds = dirtyIds.filter((id) => Object.keys(validate(drafts[id]!)).length > 0 || blankDraft(drafts[id]!));
  const measuredCount = rows.filter((r) => !validate(drafts[r.orderItemId]!).weightG).length;

  const save = useMutation<{ created: number; updated: number; unchanged: number }, ApiError>({
    mutationFn: () =>
      api(`/api/admin/batches/${batchId}/measurements`, {
        body: {
          rows: dirtyIds.map((id) => {
            const d = drafts[id]!;
            return { orderItemId: id, weightG: Number(d.weightG.trim()), lengthMm: intOrNull(d.lengthMm), widthMm: intOrNull(d.widthMm), heightMm: intOrNull(d.heightMm) };
          }),
        },
      }),
    onSuccess: (r) => {
      setSavedNote(`Saved: ${r.created} new, ${r.updated} changed.`);
      setImportNote(null);
      router.refresh();
    },
  });

  function setField(id: string, key: Field, value: string) {
    setSavedNote(null);
    setDrafts((all) => ({ ...all, [id]: { ...all[id]!, [key]: value.replace(/[^\d]/g, "") } }));
  }

  function downloadTemplate() {
    const csv = toCsv(
      ["order_item_id", "order_number", "customer", "product", "variant", "quantity", ...FIELDS.map((f) => f.csv)],
      rows.map((r) => [r.orderItemId, r.orderNumber, r.customer, r.product, r.variant, r.quantity, ...FIELDS.map((f) => drafts[r.orderItemId]![f.key])]),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${batchName.replace(/[^\w-]+/g, "-").toLowerCase()}-measurements.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importCsv(file: File) {
    const [header, ...data] = parseCsv(await file.text());
    const col = (name: string) => header?.findIndex((h) => h.trim().toLowerCase() === name) ?? -1;
    const idCol = col("order_item_id");
    if (idCol === -1) {
      setImportNote("That file has no order_item_id column. Download the template and fill it in.");
      return;
    }
    const known = new Set(rows.map((r) => r.orderItemId));
    let applied = 0;
    let unknown = 0;
    const next = { ...drafts };
    for (const line of data) {
      const id = line[idCol]?.trim() ?? "";
      if (!known.has(id)) {
        unknown += 1;
        continue;
      }
      const draft = { ...next[id]! };
      for (const f of FIELDS) {
        const c = col(f.csv);
        if (c !== -1 && line[c] !== undefined) draft[f.key] = line[c]!.trim();
      }
      next[id] = draft;
      applied += 1;
    }
    setDrafts(next);
    setSavedNote(null);
    setImportNote(`Imported ${applied} rows${unknown ? `, skipped ${unknown} that aren't in this batch` : ""}. Review the highlighted cells, then save.`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={downloadTemplate}>
          <Download aria-hidden />
          Download CSV template
        </Button>
        {editable && (
          <>
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              <Upload aria-hidden />
              Import CSV
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="Measurements CSV file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importCsv(file);
                e.target.value = "";
              }}
            />
          </>
        )}
        <span className="tabular ml-auto text-sm text-muted-foreground">
          {measuredCount} of {rows.length} items have a weight
        </span>
      </div>

      {importNote && <p className="mt-3 rounded-lg bg-info-soft px-3 py-2 text-sm">{importNote}</p>}

      <div className="mt-4 max-h-[calc(100dvh-280px)] overflow-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="sticky top-0 z-10 bg-surface text-left text-xs text-muted-foreground shadow-[inset_0_-1px_0_rgb(var(--border))]">
            <tr>
              <th className="px-3 py-3 font-medium">Order</th>
              <th className="px-3 py-3 font-medium">Item</th>
              <th className="px-3 py-3 text-right font-medium">Qty</th>
              {FIELDS.map((f) => (
                <th key={f.key} className="w-28 px-2 py-3 text-right font-medium">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const draft = drafts[row.orderItemId]!;
              const errors = validate(draft);
              const dirty = dirtyIds.includes(row.orderItemId);
              return (
                <tr key={row.orderItemId} className={cn("hover:bg-muted/40", dirty && "bg-primary/[0.03]")}>
                  <td className="px-3 py-2 align-top">
                    <p className="tabular font-medium">{row.orderNumber}</p>
                    <p className="text-xs text-muted-foreground">{row.customer}</p>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <p>{row.product}</p>
                    <p className="text-xs text-muted-foreground">{row.variant}</p>
                  </td>
                  <td className="tabular px-3 py-2 text-right align-top">{row.quantity}</td>
                  {FIELDS.map((f) => {
                    const error = dirty || draft[f.key] ? errors[f.key] : undefined;
                    return (
                      <td key={f.key} className="px-2 py-2 align-top">
                        <input
                          inputMode="numeric"
                          disabled={!editable}
                          aria-label={`${f.label} for ${row.orderNumber} ${row.product}`}
                          aria-invalid={Boolean(error)}
                          value={draft[f.key]}
                          onChange={(e) => setField(row.orderItemId, f.key, e.target.value)}
                          className={cn(
                            "tabular h-9 w-full rounded-md border bg-surface px-2 text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
                            error ? "border-danger" : draft[f.key] !== initial[row.orderItemId]![f.key] ? "border-primary" : "border-border",
                          )}
                        />
                        {error && <p className="mt-0.5 text-right text-[11px] text-danger">{error}</p>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editable && (
        <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-3 border-t border-border bg-background py-3">
          <Button disabled={dirtyIds.length === 0 || invalidIds.length > 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving" : dirtyIds.length ? `Save ${dirtyIds.length} ${dirtyIds.length === 1 ? "row" : "rows"}` : "No changes"}
          </Button>
          {dirtyIds.length > 0 && (
            <Button variant="ghost" onClick={() => setDrafts(initial)}>
              Discard changes
            </Button>
          )}
          {invalidIds.length > 0 && <span className="text-sm text-danger">Fix {invalidIds.length} {invalidIds.length === 1 ? "row" : "rows"} before saving.</span>}
          {save.error && <span className="text-sm text-danger">{save.error.message}</span>}
          {savedNote && <span className="text-sm text-success">{savedNote}</span>}
        </div>
      )}
    </div>
  );
}
