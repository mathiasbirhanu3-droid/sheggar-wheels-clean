// GET /api/auth/google/callback — Google redirects here with ?code & ?state.
// Pipeline: verify CSRF state → exchange code → fetch verified profile →
// upsert User (link by verified email, else create a RENTER) → block
// suspended accounts → create our own session cookie → return the user.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, safeReturnPath } from "@/lib/auth";
import { exchangeGoogleCode, fetchGoogleProfile, requestOrigin } from "@/lib/google-auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "sw_oauth_state";
const NEXT_COOKIE = "sw_oauth_next";

function fail(req: NextRequest, code: string) {
  // requestOrigin (Host header) instead of req.url: standalone/Docker report an
  // internal bind address in req.url, which would leak 0.0.0.0 into redirects.
  return NextResponse.redirect(new URL(`/signin?error=${code}`, requestOrigin(req)));
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // User pressed "Cancel" on the consent screen.
  if (params.get("error")) return fail(req, "google_denied");

  const queryState = params.get("state");
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;
  if (!queryState || !cookieState || queryState !== cookieState) {
    // CSRF / replay / stale tab — refuse without touching the database.
    return fail(req, "google_state");
  }

  const code = params.get("code");
  if (!code) return fail(req, "google_failed");

  const limit = rateLimit(`oauth-callback:${await clientIp()}`, 20, 60_000);
  if (!limit.ok) return fail(req, "google_slow_down");

  const origin = requestOrigin(req);

  let accessToken: string;
  try {
    accessToken = await exchangeGoogleCode(code, origin);
  } catch {
    return fail(req, "google_exchange");
  }

  let profile;
  try {
    profile = await fetchGoogleProfile(accessToken);
  } catch {
    return fail(req, "google_failed");
  }

  // Never link or create accounts on unverified Google emails.
  if (!profile.email || profile.email_verified !== true) {
    return fail(req, "google_unverified");
  }

  // Link by verified email: an existing demo account with the same email is
  // signed into directly (BR-01 unique emails make this unambiguous).
  const user =
    (await db.user.findUnique({ where: { email: profile.email } })) ??
    (await db.user.create({
      data: {
        email: profile.email,
        name: profile.name?.trim() || profile.email.split("@")[0],
        roles: [Role.RENTER], // new Google users start as renters; they can add the owner role later
      },
    }));

  if (user.status === "SUSPENDED") {
    // Same treatment as the demo sign-in: session NOT created, explained page.
    return NextResponse.redirect(new URL("/suspended", requestOrigin(req)));
  }

  await createSession(user.id);

  const nextCookie = req.cookies.get(NEXT_COOKIE)?.value;
  const target = safeReturnPath(nextCookie, "/dashboard");
  const res = NextResponse.redirect(new URL(target, requestOrigin(req)));
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(NEXT_COOKIE);
  return res;
}
