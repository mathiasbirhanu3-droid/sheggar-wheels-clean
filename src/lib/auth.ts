// Session auth (FR-01..06, BR-08, BR-09, BR-10, NFR-10).
// Demo sign-in: no passwords (FR-01) — a signed httpOnly cookie identifies the demo user.
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import type { Role, User } from "@prisma/client";

const COOKIE = "sw_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// Fail closed (NFR security): the fallback secret is public source code, so in
// production it would let anyone forge a valid session cookie for ANY user id.
// Dev keeps the fallback for zero-config DX; prod refuses to issue or trust
// tokens until SESSION_SECRET is provided. Weak secrets get a loud warning.
const configuredSecret = process.env.SESSION_SECRET || "";
const usingFallbackSecret = configuredSecret.length === 0;
const secret = usingFallbackSecret ? "sw_dev_fallback_secret" : configuredSecret;

function assertTrustworthySecret(): void {
  if (usingFallbackSecret && process.env.NODE_ENV === "production") {
    throw new Error(
      "[sheggar-wheels] SESSION_SECRET is required in production — refusing to touch session tokens. " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  if (!usingFallbackSecret && configuredSecret.length < 32) {
    console.warn(
      "[sheggar-wheels] SESSION_SECRET is shorter than 32 characters — generate a stronger one with: openssl rand -hex 32",
    );
  }
}

if (usingFallbackSecret && process.env.NODE_ENV === "production") {
  // Loud at boot too, so the misconfiguration is visible in the first log scan.
  console.error(
    "[sheggar-wheels] BOOT: SESSION_SECRET is not set — session endpoints will refuse to operate in production.",
  );
}

function sign(payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function verify(token: string): string | null {
  assertTrustworthySecret();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  const expected = sign(`${userId}.${exp}`);
  try {
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch {
    return null;
  }
  if (Number(exp) < Date.now()) return null;
  return userId;
}

export async function createSession(userId: string): Promise<void> {
  assertTrustworthySecret();
  const exp = Date.now() + MAX_AGE * 1000;
  const token = `${userId}.${exp}.${sign(`${userId}.${exp}`)}`;
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export type SessionUser = Pick<User, "id" | "email" | "name" | "phone" | "roles" | "status">;

/** Current signed-in user or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const userId = verify(token);
  if (!userId) return null;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, phone: user.phone, roles: user.roles, status: user.status };
});

/** BR-09: only internal, non-double-slash paths are safe return targets. */
export function safeReturnPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/** Guard: signed-in, else redirect to /signin (NT-01). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  return user!;
}

/** Guard: signed-in and not suspended (FR-06/BR-10). */
export async function requireActiveUser(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.status === "SUSPENDED") redirect("/suspended");
  return user;
}

/** Guard: role check (FR-05/BR-08). Non-members are sent home — no disclosure. */
export async function requireRole(...allowed: Role[]): Promise<SessionUser> {
  const user = await requireActiveUser();
  if (!user.roles.some((r) => allowed.includes(r))) redirect("/");
  return user;
}

export function hasRole(user: SessionUser, role: Role): boolean {
  return user.roles.includes(role);
}
