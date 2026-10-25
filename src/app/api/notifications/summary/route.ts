// GET /api/notifications/summary — unread count + recent items for the bell (FR-46).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [unread, recent] = await Promise.all([
    db.notification.count({ where: { userId: user.id, read: false } }),
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, title: true, body: true, link: true, read: true } }),
  ]);
  return NextResponse.json({ unread, recent });
}
