"use server";
// Booking lifecycle actions (FR-17..24, BR-03..05, BR-11). Every mutation re-checks
// session, role, ownership, and state server-side (BR-11) — UI affordances are not trusted.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth";
import { assertTransition, findConflict, validateNewBooking, demoPaymentRef, canTransition, HARD_HOLD_STATUSES } from "@/lib/bookings";
import { getPaymentMethod } from "@/lib/payments";
import { notify, notifyAdmins } from "@/lib/notifications";
import { bookingSchema, disputeSchema, paymentSchema, type ActionState } from "@/lib/validation";
import { rateLimit, scopedKey } from "@/lib/rate-limit";
import { formatETB, formatDate } from "@/lib/pricing";
import { Prisma, BookingStatus, DisputeStatus, PaymentStatus, LicenseStatus } from "@prisma/client";

type BookingWithCar = Prisma.BookingGetPayload<{ include: { car: true; owner: { select: { name: true } } } }>;

async function getBooking(id: string): Promise<BookingWithCar | null> {
  return db.booking.findUnique({ where: { id }, include: { car: true, owner: { select: { name: true } } } });
}

function refresh(id: string) {
  revalidatePath("/bookings");
  revalidatePath("/bookings/" + id);
  revalidatePath("/owner");
  revalidatePath("/admin/bookings");
}

/** FR-17/18: create a request with a server-side price snapshot. The request MUST carry
 *  the renter's driving licence (number + photo) — the owner reviews it in the dashboard. */
export async function requestBookingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const rl = rateLimit(await scopedKey("booking"), 10, 60_000); // 10 requests / min / IP (spam guard)
  if (!rl.ok) return { error: `Too many booking attempts — try again in ${rl.retryAfterSec}s.` };
  const parsed = bookingSchema.safeParse({
    carId: formData.get("carId"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    licenseNumber: formData.get("licenseNumber"),
    licenseImage: formData.get("licenseImage"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const start = new Date(parsed.data.startDate + "T00:00:00.000Z");
  const end = new Date(parsed.data.endDate + "T00:00:00.000Z");

  const result = await validateNewBooking(parsed.data.carId, start, end);
  if ("error" in result && result.error) return { error: result.error };
  const car = result.car!;

  const booking = await db.booking.create({
    data: {
      carId: car.id, renterId: user.id, ownerId: car.ownerId,
      startDate: start, endDate: end, days: result.totals!.days,
      pricePerDay: car.pricePerDay, subtotal: result.totals!.subtotal,
      discountPercent: result.totals!.discountPercent, discountAmount: result.totals!.discountAmount,
      fee: result.totals!.fee, total: result.totals!.total,
      status: BookingStatus.REQUESTED, paymentStatus: PaymentStatus.UNPAID,
      // Driving licence travels WITH the request and lands in the DB right here:
      licenseNumber: parsed.data.licenseNumber,
      licenseImage: parsed.data.licenseImage,
      licenseStatus: LicenseStatus.PENDING,
    },
  });
  await notify(car.ownerId, "New booking request", `${user.name} requested your ${car.make} ${car.model} for ${formatDate(start)} - ${formatDate(end)} (${formatETB(booking.total)}). A driving licence was submitted — review it before approving.`, "/owner/cars/" + car.id + "/bookings");
  refresh(booking.id);
  revalidatePath("/cars/" + car.id);
  redirect("/bookings/" + booking.id);
}

/** FR-20: owner approves — transactional overlap re-check (BR-05).
 *  Approving the request also approves the submitted driving licence. */
export async function approveBookingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const id = String(formData.get("bookingId") ?? "");
  const booking = await getBooking(id);
  if (!booking || booking.ownerId !== user.id) return { error: "You are not allowed to manage this booking." };
  if (!canTransition(booking.status, BookingStatus.CONFIRMED)) return { error: `This booking is ${booking.status.toLowerCase()} and can no longer be approved.` };
  const conflict = await findConflict(booking.carId, booking.startDate, booking.endDate, booking.id, HARD_HOLD_STATUSES);
  if (conflict) return { error: "Another confirmed booking already covers these dates — approval refused (BR-05)." };
  await db.booking.update({ where: { id }, data: { status: BookingStatus.CONFIRMED, licenseStatus: LicenseStatus.APPROVED } });
  await notify(booking.renterId, "Booking confirmed", `Your ${booking.car.make} ${booking.car.model} trip from ${formatDate(booking.startDate)} is confirmed — your driving licence was approved. Pick a payment method at checkout (TeleBirr, CBE Birr, M-Pesa or Chapa).`, "/bookings/" + id);
  refresh(id);
  return { ok: true, message: "Booking confirmed — licence approved. The renter can now pay at checkout." };
}

/** FR-20: owner declines — the driving licence is rejected with it (optional reason). */
export async function declineBookingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const id = String(formData.get("bookingId") ?? "");
  const note = String(formData.get("licenseDecisionNote") ?? "").trim().slice(0, 300);
  const booking = await getBooking(id);
  if (!booking || booking.ownerId !== user.id) return { error: "You are not allowed to manage this booking." };
  if (!canTransition(booking.status, BookingStatus.DECLINED)) return { error: `This booking is ${booking.status.toLowerCase()} and cannot be declined.` };
  await db.booking.update({ where: { id }, data: { status: BookingStatus.DECLINED, licenseStatus: LicenseStatus.REJECTED, ...(note ? { licenseDecisionNote: note } : {}) } });
  await notify(booking.renterId, "Booking declined", `The owner declined your request for the ${booking.car.make} ${booking.car.model}.${note ? ` Reason: ${note}` : " No payment was taken."}`, "/bookings/" + id);
  refresh(id);
  return { ok: true, message: "Request declined — the submitted licence was rejected." };
}

/** FR-21: renter cancels when the lifecycle permits it. */
export async function cancelBookingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const id = String(formData.get("bookingId") ?? "");
  const booking = await getBooking(id);
  if (!booking || booking.renterId !== user.id) return { error: "Only the renter can cancel this booking." };
  if (!canTransition(booking.status, BookingStatus.CANCELLED)) return { error: `A ${booking.status.toLowerCase()} booking cannot be cancelled.` };
  if (booking.status === BookingStatus.CONFIRMED && booking.startDate.getTime() <= Date.now()) {
    return { error: "The trip has already started — cancellation is no longer permitted." };
  }
  const refund = booking.paymentStatus === PaymentStatus.HELD;
  await db.booking.update({ where: { id }, data: { status: BookingStatus.CANCELLED, paymentStatus: refund ? PaymentStatus.REFUNDED : booking.paymentStatus } });
  await notify(booking.ownerId, "Booking cancelled", `${user.name} cancelled the ${booking.car.make} ${booking.car.model} trip (${formatDate(booking.startDate)}).${refund ? " The held payment was refunded." : ""}`, "/owner/cars/" + booking.carId + "/bookings");
  refresh(id);
  return { ok: true, message: refund ? "Booking cancelled — held payment refunded (demo)." : "Booking cancelled." };
}

/** FR-22: owner marks pickup (demo trip tracking becomes eligible). */
export async function startTripAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const id = String(formData.get("bookingId") ?? "");
  const booking = await getBooking(id);
  if (!booking || booking.ownerId !== user.id) return { error: "You are not allowed to manage this booking." };
  if (!canTransition(booking.status, BookingStatus.IN_PROGRESS)) return { error: `Cannot start a ${booking.status.toLowerCase()} booking.` };
  await db.booking.update({ where: { id }, data: { status: BookingStatus.IN_PROGRESS } });
  await notify(booking.renterId, "Trip started", `The ${booking.car.make} ${booking.car.model} handover is done. Track your simulated trip from the booking page.`, "/bookings/" + id);
  refresh(id);
  return { ok: true, message: "Trip marked as started." };
}

/** FR-22 + escrow release: owner marks return; held funds become paid. */
export async function completeTripAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const id = String(formData.get("bookingId") ?? "");
  const booking = await getBooking(id);
  if (!booking || booking.ownerId !== user.id) return { error: "You are not allowed to manage this booking." };
  if (!canTransition(booking.status, BookingStatus.COMPLETED)) return { error: `Cannot complete a ${booking.status.toLowerCase()} booking.` };
  const release = booking.paymentStatus === PaymentStatus.HELD;
  await db.booking.update({ where: { id }, data: { status: BookingStatus.COMPLETED, ...(release ? { paymentStatus: PaymentStatus.PAID } : {}) } });
  await notify(booking.renterId, "Trip completed", release ? `The ${booking.car.make} ${booking.car.model} trip is complete — the held payment was released to the owner. Leave a review!` : `The ${booking.car.make} ${booking.car.model} trip is complete. Leave a review!`, "/bookings/" + id);
  refresh(id);
  return { ok: true, message: release ? "Trip completed — held payment released to the owner." : "Trip completed." };
}

/** FR-23/24: multi-method checkout (TeleBirr / CBE Birr / M-Pesa / Chapa) — money is HELD in escrow until trip completion. */
export async function payBookingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const rl = rateLimit(await scopedKey("pay"), 6, 60_000); // 6 payment attempts / min / IP
  if (!rl.ok) return { error: `Too many payment attempts — try again in ${rl.retryAfterSec}s.` };
  const parsed = paymentSchema.safeParse({ bookingId: formData.get("bookingId"), method: formData.get("method"), contact: formData.get("contact") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const method = getPaymentMethod(parsed.data.method);
  if (!method) return { error: "Choose a payment method." };
  const booking = await getBooking(parsed.data.bookingId);
  if (!booking || booking.renterId !== user.id) return { error: "You are not allowed to pay for this booking." };
  if (booking.status !== BookingStatus.CONFIRMED) return { error: "Only a confirmed booking can be paid for." };
  if (booking.paymentStatus !== PaymentStatus.UNPAID) return { error: "This booking has already been paid." }; // idempotency guard
  const paymentRef = demoPaymentRef(method.refPrefix);
  await db.booking.update({ where: { id: booking.id }, data: { paymentStatus: PaymentStatus.HELD, paymentRef, paymentMethod: method.label } });
  await notify(booking.ownerId, "Payment held in escrow", `${user.name} paid ${formatETB(booking.total)} via ${method.label} for the ${booking.car.make} ${booking.car.model}. It stays in escrow until the trip completes (Ref ${paymentRef}).`, "/bookings/" + booking.id);
  await notifyAdmins("Payment held in escrow", `${user.name} paid ${formatETB(booking.total)} via ${method.label} for ${booking.owner.name}'s ${booking.car.make} ${booking.car.model}. Ref ${paymentRef}.`, "/admin/bookings");
  refresh(booking.id);
  revalidatePath("/checkout/" + booking.id);
  redirect("/bookings/" + booking.id + "?paid=1");
}

/** FR-39/43: either party opens a dispute (BR-07). */
export async function openDisputeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const rl = rateLimit(await scopedKey("dispute"), 5, 60_000); // 5 disputes / min / IP (spam guard)
  if (!rl.ok) return { error: `Too many attempts — try again in ${rl.retryAfterSec}s.` };
  const parsed = disputeSchema.safeParse({ bookingId: formData.get("bookingId"), reason: formData.get("reason") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const booking = await getBooking(parsed.data.bookingId);
  if (!booking || (booking.renterId !== user.id && booking.ownerId !== user.id)) return { error: "Only the renter or owner of this booking can open a dispute (BR-07)." };
  const allowed: BookingStatus[] = [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED, BookingStatus.REVIEWED];
  if (!allowed.includes(booking.status)) return { error: `A dispute cannot be opened on a ${booking.status.toLowerCase()} booking.` };
  assertTransition(booking.status, BookingStatus.DISPUTED);
  await db.$transaction([
    db.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.DISPUTED, statusBeforeDispute: booking.status } }),
    db.dispute.create({ data: { bookingId: booking.id, openedById: user.id, reason: parsed.data.reason, status: DisputeStatus.OPEN } }),
  ]);
  const other = booking.renterId === user.id ? booking.ownerId : booking.renterId;
  await notify(other, "Dispute opened", `${user.name} opened a dispute on the ${booking.car.make} ${booking.car.model} booking. The admin will review it.`, "/bookings/" + booking.id);
  await notifyAdmins("New dispute opened", `A dispute on the ${booking.car.make} ${booking.car.model} (${formatDate(booking.startDate)}) needs review.`, "/admin/disputes");
  refresh(booking.id);
  return { ok: true, message: "Dispute opened. The admin has been notified." };
}
