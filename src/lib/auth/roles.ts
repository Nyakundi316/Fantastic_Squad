// Edge-safe: imported by middleware, so no Prisma or Node APIs here.

export const ROLES = ["customer", "dropshipper", "admin", "ops", "finance", "support"] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES = ["admin", "ops", "finance", "support"] as const satisfies readonly Role[];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

/**
 * Mutations are gated by capability, never by role name at the call site.
 * Support is deliberately read-only apart from internal notes.
 */
const CAPABILITY_ROLES = {
  "admin.view": STAFF_ROLES,
  "batches.manage": ["admin", "ops"],
  "measurements.write": ["admin", "ops"],
  "allocation.approve": ["admin", "ops"],
  "shipments.write": ["admin", "ops"],
  "payments.mark_paid": ["admin", "finance"],
  "payments.refund": ["admin", "finance"],
  "payments.export": ["admin", "finance"],
  "invoices.adjust": ["admin", "finance"],
  "invoices.resend": ["admin", "finance"],
  "notes.write": STAFF_ROLES,
  "settings.write": ["admin"],
  "orders.bulk": ["dropshipper", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITY_ROLES;

export function can(role: Role, capability: Capability): boolean {
  return (CAPABILITY_ROLES[capability] as readonly Role[]).includes(role);
}

// First matching prefix wins, so keep the most specific paths on top.
const ADMIN_SECTION_ROLES: ReadonlyArray<readonly [string, readonly Role[]]> = [
  ["/admin/settings", ["admin"]],
  ["/admin/payments", ["admin", "finance", "support"]],
  ["/admin", STAFF_ROLES],
];

export function canOpenAdminPath(role: Role, pathname: string): boolean {
  const section = ADMIN_SECTION_ROLES.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return section ? section[1].includes(role) : false;
}

/** Where someone lands after signing in when no `next` was requested. */
export function homeFor(role: Role): string {
  return isStaff(role) ? "/admin" : "/";
}
