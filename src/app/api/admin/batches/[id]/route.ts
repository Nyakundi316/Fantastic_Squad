import { NextResponse } from "next/server";
import { dispatchSoon } from "@/server/notifications/dispatch";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireApiUser } from "@/server/auth/api-user";
import { transitionBatch, updateBatchSettings } from "@/server/batches/transitions";
import { HttpError, assertUuid, readJson, route } from "@/server/http";

const patchSchema = z
  .object({
    status: z.enum(["collecting", "ordered", "measured", "invoiced", "shipped", "delivered", "cancelled"]).optional(),
    // Money arrives as a string (hard rule 2) and becomes a Decimal here.
    shippingQuote: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 1250000.00")
      // Zod runs refine even when the regex failed, so this must not parse: a matching string is > 0 unless all zeros.
      .refine((v) => !/^0+(\.0+)?$/.test(v), "The quote must be more than 0.")
      .optional(),
    allocationMethod: z.enum(["weight", "volumetric", "quantity", "equal"]).optional(),
  })
  .refine((b) => b.status !== undefined || b.shippingQuote !== undefined || b.allocationMethod !== undefined, {
    message: "Nothing to update.",
  });

export const PATCH = route<{ params: { id: string } }>(async (req, { params }) => {
  const actor = await requireApiUser(req, "batches.manage");
  const batchId = assertUuid(params.id, "Batch");
  const body = await readJson(req, patchSchema);

  if (body.status && (body.shippingQuote || body.allocationMethod)) {
    throw new HttpError(422, "validation_failed", "Change the status on its own, separately from the quote or method.");
  }

  if (body.status) {
    const { batch, summary } = await transitionBatch(batchId, body.status, actor);
    await dispatchSoon();
    return NextResponse.json({ batch: { id: batch.id, status: batch.status }, summary });
  }

  const batch = await updateBatchSettings(
    batchId,
    {
      ...(body.shippingQuote ? { shippingQuote: new Prisma.Decimal(body.shippingQuote) } : {}),
      ...(body.allocationMethod ? { allocationMethod: body.allocationMethod } : {}),
    },
    actor,
  );
  return NextResponse.json({
    batch: { id: batch.id, status: batch.status, shippingQuote: batch.shippingQuote?.toFixed(2) ?? null, allocationMethod: batch.allocationMethod },
  });
});
