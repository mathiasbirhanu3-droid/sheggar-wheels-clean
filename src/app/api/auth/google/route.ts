// GET /api/auth/google — OAuth entry point: set the CSRF state cookie, then
// redirect the browser to Google's consent screen. When credentials are not
// configured the redirect lands back on /signin with a clear error code.
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { isGoogleEnabled, buildGoogleAuthUrl, requestOrigin } from "@/lib/google-auth";
import { safeReturnPath } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "sw_oauth_state";
const NEXT_COOKIE = "sw_oauth_next";

export async function GET(req: NextRequest) {
  if (!isGoogleEnabled()) {
    return NextResponse.redirect(new URL("/signin?error=google_not_configured", req.url));
  }

  const limit = rateLimit(`oauth-start:${await clientIp()}`, 20, 60_000);
  if (!limit.ok) {
    return NextResponse.redirect(new URL("/signin?error=google_slow_down", req.url));
  }

  const state = randomBytes(16).toString("hex");
  const origin = requestOrigin(req);
  const url = buildGoogleAuthUrl(origin, state);

  // Where to land after a successful sign-in (sanitized; empty = default).
  const next = safeReturnPath(req.nextUrl.searchParams.get("next"), "");

  const res = NextResponse.redirect(url);
  const cookieBase = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google", // scoped: only the OAuth routes ever read these
  };
  res.cookies.set(STATE_COOKIE, state, { ...cookieBase, maxAge: 600 });
  if (next) res.cookies.set(NEXT_COOKIE, next, { ...cookieBase, maxAge: 600 });
  return res;
}
