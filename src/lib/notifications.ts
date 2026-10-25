// In-app notifications (FR-44..46). Fire-and-forget helper used inside actions.
import "server-only";
import { db } from "@/lib/db";

export async function notify(userId: string, title: string, body: string, link?: string): Promise<void> {
  try {
    await db.notification.create({ data: { userId, title, body, link } });
  } catch {
    // Notifications must never break the primary mutation (FR-46 graceful degradation).
  }
}

export async function notifyAdmins(title: string, body: string, link?: string): Promise<void> {
  try {
    const admins = await db.user.findMany({ where: { roles: { has: "ADMIN" }, status: "ACTIVE" }, select: { id: true } });
    if (admins.length === 0) return;
    await db.notification.createMany({ data: admins.map((a) => ({ userId: a.id, title, body, link })) });
  } catch {
    // ignore
  }
}

/** Fan-out an announcement to every active user (admin announcements, FR-44). */
export async function notifyAllUsers(title: string, body: string, link?: string): Promise<void> {
  try {
    const users = await db.user.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
    if (users.length === 0) return;
    await db.notification.createMany({ data: users.map((u) => ({ userId: u.id, title, body, link })) });
  } catch {
    // ignore
  }
}
