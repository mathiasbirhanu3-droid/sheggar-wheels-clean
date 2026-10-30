"use server";
// Reviews (FR-29..31, BR-06), notifications (FR-46), admin actions (FR-40..44, BR-07/08/10).
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActiveUser, requireRole } from "@/lib/auth";
import { canTransition } from "@/lib/bookings";
import { notify, notifyAllUsers } from "@/lib/notifications";
import { reviewSchema, replySchema, resolveDisputeSchema, announcementSchema, type ActionState } from "@/lib/validation";
import { rateLimit, scopedKey } from "@/lib/rate-limit";
import { BookingStatus, DisputeStatus, UserStatus } from "@prisma/client";

// ── Reviews ───────────────────────────────────────────────────────────────

/** FR-29/30: one review per completed booking (BR-06). */
export async function createReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const rl = rateLimit(await scopedKey("review"), 5, 60_000); // 5 reviews / min / IP (spam guard)
  if (!rl.ok) return { error: `Too many review attempts — try again in ${rl.retryAfterSec}s.` };
  const parsed = reviewSchema.safeParse({ bookingId: formData.get("bookingId"), rating: formData.get("rating"), comment: formData.get("comment") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const booking = await db.booking.findUnique({ where: { id: parsed.data.bookingId }, include: { car: true } });
  if (!booking || booking.renterId !== user.id) return { error: "You can only review your own completed bookings." };
  if (booking.status !== BookingStatus.COMPLETED) return { error: "Only completed trips can be reviewed (BR-06)." };
  const existing = await db.review.findUnique({ where: { bookingId: booking.id } });
  if (existing) return { error: "This booking has already been reviewed (BR-06)." };
  await db.$transaction([
    db.review.create({ data: { bookingId: booking.id, carId: booking.carId, renterId: user.id, ownerId: booking.ownerId, rating: parsed.data.rating, comment: parsed.data.comment } }),
    db.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.REVIEWED } }),
  ]);
  await notify(booking.ownerId, "New review on your " + booking.car.make + " " + booking.car.model, `${user.name} left a ${parsed.data.rating}-star review.`, "/owner/reviews");
  revalidatePath("/bookings/" + booking.id);
  revalidatePath("/owner/reviews");
  revalidatePath("/cars/" + booking.carId);
  return { ok: true, message: "Review published. Thank you!" };
}

/** FR-31: owner replies once to a review. */
export async function replyToReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const rl = rateLimit(await scopedKey("reply"), 10, 60_000); // 10 replies / min / IP (spam guard)
  if (!rl.ok) return { error: `Too many attempts — try again in ${rl.retryAfterSec}s.` };
  const parsed = replySchema.safeParse({ reviewId: formData.get("reviewId"), reply: formData.get("reply") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const review = await db.review.findUnique({ where: { id: parsed.data.reviewId } });
  if (!review || review.ownerId !== user.id) return { error: "Only the car's owner can reply to this review." };
  if (review.ownerReply) return { error: "You have already replied to this review." };
  await db.review.update({ where: { id: review.id }, data: { ownerReply: parsed.data.reply, repliedAt: new Date() } });
  await notify(review.renterId, "The owner replied to your review", "Your review received a public reply.", "/bookings/" + review.bookingId);
  revalidatePath("/owner/reviews");
  revalidatePath("/bookings/" + review.bookingId);
  return { ok: true, message: "Reply published." };
}

// ── Notifications (FR-46) ─────────────────────────────────────────────────

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await requireActiveUser();
  await db.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } });
  revalidatePath("/notifications");
}

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const user = await requireActiveUser();
  const id = String(formData.get("id") ?? "");
  await db.notification.updateMany({ where: { id, userId: user.id }, data: { read: true } });
  revalidatePath("/notifications");
}

// ── Admin (FR-40..44) ─────────────────────────────────────────────────────

/** FR-40 / BR-02: approve a pending listing. */
export async function approveListingAction(formData: FormData): Promise<void> {
  await requireRole("ADMIN");
  const carId = String(formData.get("carId") ?? "");
  const car = await db.car.findUnique({ where: { id: carId } });
  if (!car || (car.status !== "PENDING" && car.status !== "REJECTED")) return;
  await db.car.update({ where: { id: carId }, data: { status: "APPROVED" } });
  await notify(car.ownerId, "Listing approved", `Your ${car.make} ${car.model} is now live in the catalogue.`, "/owner/cars");
  revalidatePath("/admin/listings");
  revalidatePath("/cars");
  revalidatePath("/owner/cars");
}

/** FR-40 / BR-02: reject a listing. */
export async function rejectListingAction(formData: FormData): Promise<void> {
  await requireRole("ADMIN");
  const carId = String(formData.get("carId") ?? "");
  const car = await db.car.findUnique({ where: { id: carId } });
  if (!car || (car.status !== "PENDING" && car.status !== "APPROVED")) return;
  await db.car.update({ where: { id: carId }, data: { status: "REJECTED" } });
  await notify(car.ownerId, "Listing rejected", `Your ${car.make} ${car.model} was not approved. Edit the listing and resubmit it.`, "/owner/cars");
  revalidatePath("/admin/listings");
  revalidatePath("/cars");
  revalidatePath("/owner/cars");
}

/** FR-50 / BR-08: approve a renter's driving licence — unlocks self-drive bookings
 *  on every car. Decided ONLY here (admin), never by owners. */
export async function approveDrivingLicenseAction(formData: FormData): Promise<void> {
  await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, drivingLicenseStatus: true } });
  if (!target || target.drivingLicenseStatus !== "PENDING") return;
  await db.user.update({ where: { id: userId }, data: { drivingLicenseStatus: "APPROVED", drivingLicenseNote: null } });
  await notify(userId, "Driving licence approved", "Your driving licence was approved — you can now book any car self-drive.", "/profile");
  revalidatePath("/admin/licenses");
  revalidatePath("/profile");
}

/** FR-50 / BR-08: reject a renter's driving licence with an optional note; the
 *  renter can re-upload on /profile (status returns to PENDING). */
export async function rejectDrivingLicenseAction(formData: FormData): Promise<void> {
  await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 300);
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, drivingLicenseStatus: true } });
  if (!target || target.drivingLicenseStatus !== "PENDING") return;
  await db.user.update({ where: { id: userId }, data: { drivingLicenseStatus: "REJECTED", drivingLicenseNote: note || null } });
  await notify(userId, "Driving licence rejected", note ? `Your driving licence was not approved. Reason: ${note} You can upload a clearer photo on your profile.` : "Your driving licence was not approved. Upload a clearer photo on your profile.", "/profile");
  revalidatePath("/admin/licenses");
  revalidatePath("/profile");
}

/** FR-41 / BR-10: suspend a demo account. */
export async function suspendUserAction(formData: FormData): Promise<void> {
  const admin = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  if (userId === admin.id) return;
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target || target.roles.includes("ADMIN")) return;
  await db.user.update({ where: { id: userId }, data: { status: UserStatus.SUSPENDED } });
  await notify(userId, "Account suspended", "Your account was suspended by the admin. You cannot perform actions until reinstated.");
  revalidatePath("/admin/users");
  revalidatePath("/admin/users/" + userId);
}

/** FR-41: reinstate a suspended account. */
export async function reinstateUserAction(formData: FormData): Promise<void> {
  await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) return;
  await db.user.update({ where: { id: userId }, data: { status: UserStatus.ACTIVE } });
  await notify(userId, "Account reinstated", "Your account is active again. Welcome back!");
  revalidatePath("/admin/users");
  revalidatePath("/admin/users/" + userId);
}

/** FR-43 / BR-07: resolve a dispute with recorded notes. */
export async function resolveDisputeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = resolveDisputeSchema.safeParse({ disputeId: formData.get("disputeId"), notes: formData.get("notes") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const dispute = await db.dispute.findUnique({ where: { id: parsed.data.disputeId }, include: { booking: { include: { car: true } } } });
  if (!dispute || dispute.status !== DisputeStatus.OPEN) return { error: "This dispute is not open." };
  const booking = dispute.booking;
  await db.$transaction([
    db.dispute.update({ where: { id: dispute.id }, data: { status: DisputeStatus.RESOLVED, resolutionNotes: parsed.data.notes, resolvedById: admin.id, resolvedAt: new Date() } }),
    db.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.COMPLETED, statusBeforeDispute: null } }),
  ]);
  const body = `The admin resolved the dispute on the ${booking.car.make} ${booking.car.model}: "${parsed.data.notes}"`;
  await notify(booking.renterId, "Dispute resolved", body, "/bookings/" + booking.id);
  await notify(booking.ownerId, "Dispute resolved", body, "/bookings/" + booking.id);
  revalidatePath("/admin/disputes");
  revalidatePath("/admin/disputes/" + dispute.id);
  revalidatePath("/bookings/" + booking.id);
  return { ok: true, message: "Dispute resolved and parties notified." };
}

/** FR-44: create an announcement and fan it out in-app (BR-12). */
export async function createAnnouncementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = announcementSchema.safeParse({ title: formData.get("title"), body: formData.get("body") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  await db.announcement.create({ data: { ...parsed.data, createdById: admin.id } });
  await notifyAllUsers("Platform announcement", parsed.data.title, "/dashboard");
  revalidatePath("/admin/announcements");
  revalidatePath("/");
  revalidatePath("/dashboard");
  return { ok: true, message: "Announcement published to all active users." };
}

/** FR-44: toggle an announcement's active flag. */
export async function toggleAnnouncementAction(formData: FormData): Promise<void> {
  await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const a = await db.announcement.findUnique({ where: { id } });
  if (!a) return;
  await db.announcement.update({ where: { id }, data: { active: !a.active } });
  revalidatePath("/admin/announcements");
  revalidatePath("/");
}
