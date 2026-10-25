import type { Prisma, Setting } from "@prisma/client";
import { db } from "@/lib/db";

type Client = Prisma.TransactionClient | typeof db;

/**
 * The single settings row. Created on first read with the schema defaults
 * (volumetric divisor 5000, currency NGN), so the divisor is never hardcoded
 * in application code (hard rule 9).
 */
export async function getSettings(client: Client = db): Promise<Setting> {
  const existing = await client.setting.findFirst({ orderBy: { createdAt: "asc" } });
  return existing ?? client.setting.create({ data: { currency: process.env.CURRENCY ?? "NGN" } });
}
