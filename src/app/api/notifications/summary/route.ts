// GET /api/notifications/summary — the ONLY data source of the notification bell.
//
// Returns:
//   unread — how many notifications this user has NOT seen yet (read = false).
//            This number is exactly what the red badge on the bell shows.
//   recent — the 8 newest notifications (seen or unseen) for the dropdown list.
//
// Requires a signed-in session; answers 401 otherwise (the bell stays quiet).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [unread, recent] = await Promise.all([
    // badge = UNSEEN only
    db.notification.count({ where: { userId: user.id, read: false } }),
    // dropdown = newest 8, seen or unseen
    db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, title: true, body: true, link: true, read: true },
    }),
  ]);

  return NextResponse.json({ unread, recent });
}
