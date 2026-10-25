// Google OAuth 2.0 (OpenID Connect), hand-rolled with plain fetch — no new
// dependencies. Deliberately minimal: we only need "who is this email?" and we
// already have our own signed-cookie session system (src/lib/auth.ts), so the
// callback just upserts the User and calls createSession().
//
// Feature-flagged: the "Continue with Google" buttons render ONLY when both
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured (.env). Without
// them the app behaves exactly as before — demo email sign-in.
import "server-only";
import { createLogger } from "@/lib/logger";

const log = createLogger("google-auth");

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

export type GoogleProfile = {
  sub: string; // stable Google account id
  email: string;
  email_verified: boolean;
  name?: string;
};

/** Google sign-in is available only when both credentials are configured. */
export function isGoogleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured");
  return { clientId, clientSecret };
}

/** The callback URL must byte-match the one registered in Google Cloud Console. */
export function callbackUrl(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

/**
 * Derive the PUBLIC origin from the Host header (not req.url — standalone
 * servers often report an internal bind address like 0.0.0.0, and Google
 * requires the redirect_uri to byte-match the Console registration).
 * Honors proxy headers for deployed setups.
 */
export function requestOrigin(req: { headers: Headers; url: string }): string {
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** Consent-screen URL. `state` is our CSRF token (verified in the callback). */
export function buildGoogleAuthUrl(origin: string, state: string): string {
  const { clientId } = credentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl(origin),
    response_type: "code",
    scope: "openid email profile",
    state,
    // Let the user pick an account every time — avoids silent wrong-account logins.
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** OAuth 2.0 authorization-code exchange. Throws with the provider error text. */
export async function exchangeGoogleCode(code: string, origin: string): Promise<string> {
  const { clientId, clientSecret } = credentials();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl(origin),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log.error("token exchange failed", { status: res.status });
    throw new Error(`google token exchange failed (${res.status}) ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("google token response missing access_token");
  return json.access_token;
}

/** Fetch the OpenID Connect profile for an access token. */
export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    log.error("userinfo fetch failed", { status: res.status });
    throw new Error(`google userinfo failed (${res.status})`);
  }
  return (await res.json()) as GoogleProfile;
}
