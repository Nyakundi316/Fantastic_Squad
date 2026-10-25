import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/api-user";
import { previewAllocation } from "@/server/allocation/batch-allocation";
import { assertUuid, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** Computes the split without writing anything. 422 with a reason when it can't be computed yet. */
export const GET = route<{ params: { id: string } }>(async (req, { params }) => {
  await requireApiUser(req, "admin.view");
  const preview = await previewAllocation(assertUuid(params.id, "Batch"));

  if (preview.error) {
    return NextResponse.json({ error: preview.error, approved: preview.approved }, { status: 422 });
  }
  return NextResponse.json({
    approved: preview.approved,
    fingerprint: preview.fingerprint,
    method: preview.result.method,
    quote: preview.result.quote,
    volumetricDivisor: preview.result.volumetricDivisor,
    totalChargeableWeightG: preview.result.totalChargeableWeightG,
    allocatedTotal: preview.allocatedTotal,
    orders: preview.rows,
  });
});
