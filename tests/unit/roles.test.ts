import { describe, expect, it } from "vitest";
import { ROLES, can, canOpenAdminPath, homeFor, isRole, isStaff } from "@/lib/auth/roles";

describe("capabilities", () => {
  it("lets only admin and ops approve allocations and enter measurements", () => {
    const allowed = ROLES.filter((r) => can(r, "allocation.approve"));
    expect(allowed).toEqual(["admin", "ops"]);
    expect(ROLES.filter((r) => can(r, "measurements.write"))).toEqual(["admin", "ops"]);
  });

  it("keeps money mutations with admin and finance", () => {
    for (const cap of ["payments.mark_paid", "payments.refund", "payments.export"] as const) {
      expect(ROLES.filter((r) => can(r, cap))).toEqual(["admin", "finance"]);
    }
  });

  it("gives support notes but no money or batch mutations", () => {
    expect(can("support", "notes.write")).toBe(true);
    expect(can("support", "payments.mark_paid")).toBe(false);
    expect(can("support", "batches.manage")).toBe(false);
    expect(can("support", "allocation.approve")).toBe(false);
  });

  it("lets dropshippers place bulk orders but not see admin", () => {
    expect(can("dropshipper", "orders.bulk")).toBe(true);
    expect(can("customer", "orders.bulk")).toBe(false);
    expect(can("dropshipper", "admin.view")).toBe(false);
  });
});

describe("admin sections", () => {
  it("blocks customers and dropshippers from all of /admin", () => {
    for (const role of ["customer", "dropshipper"] as const) {
      expect(canOpenAdminPath(role, "/admin")).toBe(false);
      expect(canOpenAdminPath(role, "/admin/batches/123")).toBe(false);
    }
  });

  it("restricts settings to admin and the payments ledger to admin, finance, support", () => {
    expect(canOpenAdminPath("admin", "/admin/settings")).toBe(true);
    expect(canOpenAdminPath("ops", "/admin/settings")).toBe(false);
    expect(canOpenAdminPath("finance", "/admin/payments")).toBe(true);
    expect(canOpenAdminPath("ops", "/admin/payments")).toBe(false);
    expect(canOpenAdminPath("ops", "/admin/batches/abc/measurements")).toBe(true);
  });

  it("does not treat look-alike prefixes as the section", () => {
    expect(canOpenAdminPath("ops", "/admin/settings-export")).toBe(true);
    expect(canOpenAdminPath("customer", "/administrator")).toBe(false);
  });
});

describe("helpers", () => {
  it("identifies staff and valid roles", () => {
    expect(ROLES.filter(isStaff)).toEqual(["admin", "ops", "finance", "support"]);
    expect(isRole("finance")).toBe(true);
    expect(isRole("root")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it("sends staff to /admin and everyone else to the shop", () => {
    expect(homeFor("support")).toBe("/admin");
    expect(homeFor("customer")).toBe("/");
    expect(homeFor("dropshipper")).toBe("/");
  });
});
