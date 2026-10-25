"use server";
// Auth actions (FR-01..06, BR-01, BR-08, BR-09).
// v3: email+password credentials (strong rules at creation, scrypt at rest).
// Google OAuth is unchanged; seeded demo accounts use the shared demo password.
// Security events (failed sign-in, suspended-block, success, abuse throttle)
// all emit structured logs — the minimum audit trail a deployment needs (NFR-10).
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession, getCurrentUser, safeReturnPath } from "@/lib/auth";
import { rateLimit, scopedKey } from "@/lib/rate-limit";
import { createLogger } from "@/lib/logger";
import { signInSchema, signUpSchema, type ActionState } from "@/lib/validation";
import { hashPassword, verifyPassword } from "@/lib/password";
import { Role } from "@prisma/client";

const log = createLogger("auth");

// Generic credential error — identical for "unknown email" and "wrong
// password" so sign-in cannot be used to enumerate registered accounts.
const BAD_CREDENTIALS = "Invalid email or password. Seeded accounts can be filled below.";

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const rl = rateLimit(await scopedKey("signin"), 10, 60_000); // 10 attempts / min / IP
  if (!rl.ok) return { error: `Too many sign-in attempts — try again in ${rl.retryAfterSec}s.` };
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const email = parsed.data.email.toLowerCase().trim();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    log.warn("sign-in failed: unknown email", { email });
    return { error: BAD_CREDENTIALS };
  }
  // Google-only account (no local credential set) — point the user at the OAuth path.
  if (!user.passwordHash) {
    log.warn("sign-in failed: password-less (Google-only) account", { userId: user.id, email });
    return { error: "This account uses Google sign-in — tap \u201cContinue with Google\u201d above." };
  }
  const passwordOk = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!passwordOk) {
    log.warn("sign-in failed: wrong password", { userId: user.id, email });
    return { error: BAD_CREDENTIALS };
  }
  if (user.status === "SUSPENDED") {
    // Checked only AFTER the password verifies, so the suspension message is
    // visible to the legitimate account holder, not to credential-guessers.
    log.warn("sign-in blocked: suspended account", { userId: user.id, email });
    return { error: "This account is suspended and cannot sign in (FR-06)." };
  }
  await createSession(user.id);
  log.info("sign-in success", { userId: user.id, roles: user.roles });
  redirect(safeReturnPath(parsed.data.next));
}

export async function signUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const rl = rateLimit(await scopedKey("signup"), 5, 60_000); // 5 accounts / min / IP
  if (!rl.ok) return { error: `Too many sign-up attempts — try again in ${rl.retryAfterSec}s.` };
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    asOwner: formData.get("asOwner") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const email = parsed.data.email.toLowerCase().trim();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    log.warn("sign-up refused: duplicate email", { email });
    return { error: "That email is already registered — duplicate accounts are refused (BR-01)." };
  }
  const passwordHash = await hashPassword(parsed.data.password);
  const user = await db.user.create({
    data: {
      email,
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      passwordHash,
      roles: parsed.data.asOwner ? [Role.OWNER, Role.RENTER] : [Role.RENTER],
    },
  });
  await createSession(user.id);
  log.info("sign-up success", { userId: user.id, roles: user.roles, credentials: "password" });
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  const user = await getCurrentUser();
  await destroySession();
  if (user) log.info("sign-out", { userId: user.id });
  redirect("/");
}
