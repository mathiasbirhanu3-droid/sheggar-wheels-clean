// GET /api/export/admin-report — server-generated CSV platform report (FR-44).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return '"' + s.replace(/"/g, '""') + '"';
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const users = await db.user.findMany({ include: { _count: { select: { renterBookings: true, cars: true } } }, orderBy: { createdAt: "asc" } });
  const header = ["user_id", "name", "email", "phone", "roles", "status", "bookings_as_renter", "cars_listed", "joined_at"];
  const lines = [header.map(csvCell).join(",")];
  for (const u of users) {
    lines.push([u.id, u.name, u.email, u.phone ?? "", u.roles.join("|"), u.status, u._count.renterBookings, u._count.cars, u.createdAt.toISOString()].map(csvCell).join(","));
  }
  return new NextResponse(lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sheggar-wheels-report-${Date.now()}.csv"` },
  });
}
