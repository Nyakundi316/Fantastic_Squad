import { db } from "@/lib/db";

let tableList: string | undefined;

/**
 * Empties every table between tests. TRUNCATE needs exclusive locks on all of
 * them, so it can occasionally collide with a connection still finishing up;
 * a short lock timeout plus a retry keeps that from stalling the suite.
 */
export async function resetDatabase() {
  if (!tableList) {
    const tables = await db.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`;
    tableList = tables.map((t) => `"${t.tablename}"`).join(", ");
  }

  for (let attempt = 1; ; attempt++) {
    try {
      await db.$transaction([
        db.$executeRawUnsafe(`SET LOCAL lock_timeout = '3s'`),
        db.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} CASCADE`),
        db.$executeRawUnsafe(`ALTER SEQUENCE "order_number_seq" RESTART WITH 1001`),
      ]);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = /40P01|55P03|deadlock|lock timeout/i.test(message);
      if (!retryable || attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
}

export { db };
