// Liveness + readiness probe for load balancers, Docker healthcheck and uptime monitors.
// 200 = serving traffic OK (DB reachable); 503 = degraded (process up, DB unreachable).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

export async function GET() {
  const checks: Record<string, "ok" | "fail"> = { database: "fail" };
  let dbLatencyMs: number | null = null;

  try {
    const t0 = Date.now();
    await db.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - t0;
    checks.database = "ok";
  } catch {
    // Intentionally swallow details — health endpoints must not leak internals.
  }

  const ok = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      service: site.name,
      version: site.version,
      checks,
      dbLatencyMs,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
