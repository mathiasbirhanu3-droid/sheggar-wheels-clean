// Booking lifecycle guards (SRS Chapter 6, BR-05, FR-19/20/35).
import "server-only";
import { db } from "@/lib/db";
import { BookingStatus, PaymentStatus, AnnouncementKind } from "@prisma/client";
import { rangesOverlap, hitsBlockedDates, computeTotals, toISODate } from "@/lib/pricing";

/** States that hold the car's calendar (BR-05). */
export const BLOCKING_STATUSES: BookingStatus[] = [BookingStatus.REQUESTED, BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS, BookingStatus.DISPUTED];

/** Permitted transitions (SRS Chapter 6 finite state machine). */
export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  REQUESTED: [BookingStatus.CONFIRMED, BookingStatus.DECLINED, BookingStatus.CANCELLED],
  CONFIRMED: [BookingStatus.IN_PROGRESS, BookingStatus.CANCELLED, BookingStatus.DISPUTED],
  IN_PROGRESS: [BookingStatus.COMPLETED, BookingStatus.DISPUTED],
  COMPLETED: [BookingStatus.REVIEWED, BookingStatus.DISPUTED],
  REVIEWED: [],
  DECLINED: [],
  CANCELLED: [],
  DISPUTED: [BookingStatus.RESOLVED],
  RESOLVED: [BookingStatus.COMPLETED], // restore after dispute resolution
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class LifecycleError extends Error {}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) throw new LifecycleError(`Cannot move a ${from.toLowerCase()} booking to ${to.toLowerCase()}.`);
}

/**
 * BR-05 overlap check: returns a conflicting booking for the car intersecting
 * [start,end] among the given statuses, or null. Excludes the booking being mutated.
 * - Creation time: all BLOCKING_STATUSES (soft hold on requests).
 * - Approval time: only CONFIRMED/IN_PROGRESS/DISPUTED — two requests may coexist;
 *   they just cannot both be confirmed (SRS FR-19/BR-05).
 */
export async function findConflict(carId: string, start: Date, end: Date, excludeId?: string, statuses: BookingStatus[] = BLOCKING_STATUSES) {
  const actives = await db.booking.findMany({ where: { carId, status: { in: statuses }, ...(excludeId ? { id: { not: excludeId } } : {}) } });
  return actives.find((b) => rangesOverlap(start, end, b.startDate, b.endDate)) ?? null;
}

/** Statuses that hard-hold the calendar at approval time. */
export const HARD_HOLD_STATUSES: BookingStatus[] = [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS, BookingStatus.DISPUTED];

/**
 * Live discount for ONE car (badge + voucher maths).
 * Rules: kind=DISCOUNT, admin-approved (active), not expired, targeting this car.
 * If several are somehow live, the renter gets the highest — one deterministic winner.
 */
export async function getActiveCarDiscount(carId: string): Promise<number> {
  const now = new Date();
  const offer = await db.announcement.findFirst({
    where: { carId, kind: AnnouncementKind.DISCOUNT, active: true, OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
    orderBy: { discountPercent: "desc" },
    select: { discountPercent: true },
  });
  return offer?.discountPercent ?? 0;
}

/**
 * Batch version for card grids: ONE query answers "which of these N cars has a
 * live discount?" — the anti-N+1 pattern. Duplicate offers for the same car
 * arrive sorted by percent desc, so the first seen per car is the winner.
 */
export async function getActiveDiscountMap(carIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (carIds.length === 0) return map;
  const now = new Date();
  const offers = await db.announcement.findMany({
    where: { carId: { in: carIds }, kind: AnnouncementKind.DISCOUNT, active: true, OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
    orderBy: { discountPercent: "desc" },
    select: { carId: true, discountPercent: true },
  });
  for (const o of offers) if (o.carId && !map.has(o.carId)) map.set(o.carId, o.discountPercent ?? 0);
  return map;
}

/** Full request-time validation for a new booking on an approved+active car. */
export async function validateNewBooking(carId: string, start: Date, end: Date, excludeId?: string) {
  const car = await db.car.findUnique({ where: { id: carId } });
  if (!car || car.status !== "APPROVED") return { error: "This car is not available for booking." as const };
  const discountPercent = await getActiveCarDiscount(carId);
  const totals = computeTotals(car.pricePerDay, start, end, discountPercent);
  if (!totals) return { error: "The selected dates are not a valid range." as const };
  const future = new Date(toISODate(new Date()) + "T00:00:00.000Z");
  if (end.getTime() < future.getTime()) return { error: "The return date cannot be in the past." as const };
  if (hitsBlockedDates(start, end, car.unavailableDates)) return { error: "The owner has blocked some of the selected dates. Please choose another range." as const };
  const conflict = await findConflict(carId, start, end, excludeId);
  if (conflict) return { error: "Those dates overlap another active booking for this car (BR-05)." as const, conflict };
  return { car, totals };
}

/** Generates the demo payment reference (FR-24): SW-DEMO-<PREFIX>-XXXX, e.g. SW-DEMO-TB-9F3K. */
export function demoPaymentRef(prefix?: string): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return prefix ? `SW-DEMO-${prefix}-${rand}` : "SW-DEMO-" + rand;
}

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  UNPAID: "Unpaid",
  HELD: "Held in escrow",
  PAID: "Paid — released to owner",
  REFUNDED: "Refunded",
};
