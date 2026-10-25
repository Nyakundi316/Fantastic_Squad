import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { safeNextPath, signSession, verifySession } from "@/lib/auth/session";

describe("session tokens", () => {
  it("round-trips user id and role", async () => {
    const token = await signSession({ userId: "8a1d3c1e-0000-4000-8000-000000000001", role: "ops" });
    await expect(verifySession(token)).resolves.toEqual({
      userId: "8a1d3c1e-0000-4000-8000-000000000001",
      role: "ops",
    });
  });

  it("rejects a tampered token", async () => {
    const token = await signSession({ userId: "u1", role: "customer" });
    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: "u1", role: "admin", iss: "fantasticzone" })).toString("base64url");
    await expect(verifySession(`${header}.${forgedPayload}.${signature}`)).resolves.toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const foreign = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setIssuer("fantasticzone")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-completely-different-secret-of-32+chars"));
    await expect(verifySession(foreign)).resolves.toBeNull();
  });

  it("rejects expired tokens and unknown roles", async () => {
    const expired = await signSession({ userId: "u1", role: "admin" }, -10);
    await expect(verifySession(expired)).resolves.toBeNull();

    const badRole = await new SignJWT({ role: "superuser" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setIssuer("fantasticzone")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    await expect(verifySession(badRole)).resolves.toBeNull();
  });

  it("treats a missing cookie as signed out", async () => {
    await expect(verifySession(undefined)).resolves.toBeNull();
    await expect(verifySession("not-a-jwt")).resolves.toBeNull();
  });
});

describe("safeNextPath", () => {
  it("allows same-site relative paths", () => {
    expect(safeNextPath("/orders/FZ-1001?tab=invoice")).toBe("/orders/FZ-1001?tab=invoice");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/login?next=/admin", "/api/auth/me", "", undefined])(
    "rejects %j",
    (value) => {
      expect(safeNextPath(value)).toBeNull();
    },
  );
});
