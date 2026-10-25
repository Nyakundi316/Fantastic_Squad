import { NextResponse } from "next/server";
import { listActiveBatches } from "@/server/batches/active";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const batches = await listActiveBatches();
  return NextResponse.json({
    batches: batches.map((b) => ({
      id: b.id,
      name: b.name,
      shipMethod: b.shipMethod,
      openedAt: b.openedAt.toISOString(),
      cutoffAt: b.cutoffAt.toISOString(),
      memberCount: b.memberCount,
    })),
  });
});
