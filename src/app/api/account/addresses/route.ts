import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { addressInputSchema } from "@/server/addresses";
import { requireApiUser } from "@/server/auth/api-user";
import { readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const user = await requireApiUser(req);
  const addresses = await db.address.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ addresses });
});

export const POST = route(async (req) => {
  const user = await requireApiUser(req);
  const input = await readJson(req, addressInputSchema);

  const address = await db.$transaction(async (tx) => {
    const existing = await tx.address.count({ where: { userId: user.id } });
    const makeDefault = input.isDefault || existing === 0;
    if (makeDefault) await tx.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    return tx.address.create({ data: { ...input, userId: user.id, isDefault: makeDefault } });
  });

  return NextResponse.json({ address }, { status: 201 });
});
