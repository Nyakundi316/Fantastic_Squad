import { NextResponse } from "next/server";
import { dispatchSoon } from "@/server/notifications/dispatch";
import { z } from "zod";
import { requireApiUser } from "@/server/auth/api-user";
import { approveAllocation } from "@/server/allocation/batch-allocation";
import { assertUuid, readJson, route } from "@/server/http";

const bodySchema = z.object({ fingerprint: z.string().min(16).max(64) });

/** Idempotent: a second approval is 409 and sends nothing. */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const actor = await requireApiUser(req, "allocation.approve");
  const batchId = assertUuid(params.id, "Batch");
  const { fingerprint } = await readJson(req, bodySchema);
  const { result, invoices } = await approveAllocation(batchId, actor, fingerprint);
  await dispatchSoon();
  return NextResponse.json({ approved: true, invoices, quote: result.quote, method: result.method });
});
