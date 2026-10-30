// GET /api/export/owner-earnings — owner CSV (FR-37).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { toISODate } from "@/lib/pricing";

export const dynamic = "force-dynamic";

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return '"' + s.replace(/"/g, '""') + '"';
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("OWNER")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db.booking.findMany({
    where: { ownerId: user.id, status: { in: ["COMPLETED", "REVIEWED", "RESOLVED"] } },
    orderBy: { startDate: "desc" },
    include: { car: { select: { make: true, model: true, year: true } }, renter: { select: { name: true } } },
  });

  // owner_income_etb = subtotal − discount + driverTotal (what the owner keeps — the
  // driver is the owner's); the 10% service fee on the OVERALL price (FR-49) is
  // platform income (the admin's) and is listed separately, never merged.
  const header = ["booking_id", "car", "renter", "drive_mode", "start_date", "end_date", "days", "driver_fee_etb", "owner_income_etb", "platform_fee_etb", "released", "status"];
  const lines = [header.map(csvCell).join(",")];
  for (const b of rows) {
    lines.push([b.id, `${b.car.make} ${b.car.model} ${b.car.year}`, b.renter.name, b.driveMode, toISODate(b.startDate), toISODate(b.endDate), b.days, b.driverTotal, b.subtotal - b.discountAmount + b.driverTotal, b.fee, b.paymentStatus, b.status].map(csvCell).join(","));
  }
  return new NextResponse(lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sheggar-wheels-earnings-${Date.now()}.csv"` },
  });
}
