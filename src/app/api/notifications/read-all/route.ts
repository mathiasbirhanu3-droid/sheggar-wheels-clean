// POST /api/notifications/read-all — "the user opened the bell, so they have
// SEEN everything in it". Every unseen (read = false) notification of the
// signed-in user becomes read = true, permanently, in the database.
//
// This is why the badge number vanishes for good: after this call the count
// of read = false rows is 0, on every device and after every reload.
//
// Requires a signed-in session; answers 401 otherwise.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { count } = await db.notification.updateMany({
    where: { userId: user.id, read: false },
    data: { read: true },
  });

  return NextResponse.json({ ok: true, seen: count });
}
