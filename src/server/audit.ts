import type { Prisma } from "@prisma/client";

type AuditEntry = {
  actorId: string | null;
  /** "<entity>.<verb>", e.g. measurement.updated */
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
};

/** Hard rule 10: every admin mutation writes audit_log, inside the same transaction as the change. */
export function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry) {
  return tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before ?? undefined,
      after: entry.after ?? undefined,
    },
  });
}
