// GET /api/export/bookings — renter CSV export (FR-27): own rows only, RFC-quoted.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { toISODate } from "@/lib/pricing";
import type { BookingStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return '"' + s.replace(/"/g, '""') + '"'; // quotes commas, quotes, and newlines (FR-27)
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const allowed: BookingStatus[] = ["REQUESTED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "REVIEWED", "DECLINED", "CANCELLED", "DISPUTED", "RESOLVED"];
  const rows = await db.booking.findMany({
    where: { renterId: user.id, ...(status && allowed.includes(status.toUpperCase() as BookingStatus) ? { status: status.toUpperCase() as BookingStatus } : {}) },
    orderBy: { startDate: "desc" },
    include: { car: { select: { make: true, model: true, year: true } } },
  });

  const header = ["booking_id", "car", "start_date", "end_date", "days", "price_per_day_etb", "subtotal_etb", "fee_etb", "total_etb", "status", "payment_status", "payment_ref", "created_at"];
  const lines = [header.map(csvCell).join(",")];
  for (const b of rows) {
    lines.push([b.id, `${b.car.make} ${b.car.model} ${b.car.year}`, toISODate(b.startDate), toISODate(b.endDate), b.days, b.pricePerDay, b.subtotal, b.fee, b.total, b.status, b.paymentStatus, b.paymentRef, b.createdAt.toISOString()].map(csvCell).join(","));
  }
  const csv = lines.join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sheggar-wheels-bookings-${Date.now()}.csv"`,
    },
  });
}
