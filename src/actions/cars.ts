"use server";
// Owner listing actions (FR-32..35, BR-02, BR-03, BR-11).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, requireActiveUser } from "@/lib/auth";
import { notify, notifyAdmins } from "@/lib/notifications";
import { carSchema, type ActionState } from "@/lib/validation";
import { rangesOverlap, toISODate } from "@/lib/pricing";
import { BLOCKING_STATUSES } from "@/lib/bookings";
import { rateLimit, scopedKey } from "@/lib/rate-limit";
import { CarStatus } from "@prisma/client";

function refresh(carId: string) {
  revalidatePath("/owner");
  revalidatePath("/owner/cars");
  revalidatePath("/owner/cars/" + carId);
  revalidatePath("/owner/cars/" + carId + "/edit");
  revalidatePath("/owner/cars/" + carId + "/availability");
  revalidatePath("/cars");
  revalidatePath("/cars/" + carId);
  revalidatePath("/");
}

async function ownCar(carId: string, userId: string) {
  const car = await db.car.findUnique({ where: { id: carId } });
  if (!car || car.ownerId !== userId) return null;
  return car;
}

/** FR-32: create a listing; it starts PENDING for admin moderation (BR-02). */
export async function createCarAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("OWNER");
  const rl = rateLimit(await scopedKey("car-create"), 5, 60_000); // 5 listings / min / IP (spam guard)
  if (!rl.ok) return { error: `Too many listing attempts — try again in ${rl.retryAfterSec}s.` };
  const photos = formData.getAll("photos").map(String).filter(Boolean);
  const parsed = carSchema.safeParse({
    make: formData.get("make"), model: formData.get("model"), year: formData.get("year"),
    transmission: formData.get("transmission"), fuelType: formData.get("fuelType") || "PETROL", seats: formData.get("seats"),
    city: formData.get("city") || "Addis Ababa", neighbourhood: formData.get("neighbourhood"),
    pricePerDay: formData.get("pricePerDay"), description: formData.get("description"), photos,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const car = await db.car.create({
    data: {
      ownerId: user.id, ...parsed.data,
      lat: 9.0054 + (Math.random() - 0.5) * 0.02, // seeded sample coordinate (C7), never live GPS
      lng: 38.7636 + (Math.random() - 0.5) * 0.02,
      status: CarStatus.PENDING,
    },
  });
  await notifyAdmins("New listing awaiting moderation", `${user.name} listed a ${parsed.data.make} ${parsed.data.model}.`, "/admin/listings");
  refresh(car.id);
  redirect("/owner");
}

/** FR-33: edit own listing. Existing bookings keep their snapshots (BR-03). */
export async function updateCarAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const carId = String(formData.get("carId") ?? "");
  const car = await ownCar(carId, user.id);
  if (!car) return { error: "You can only edit your own listings (NT-04)." };
  const photos = formData.getAll("photos").map(String).filter(Boolean);
  const parsed = carSchema.safeParse({
    make: formData.get("make"), model: formData.get("model"), year: formData.get("year"),
    transmission: formData.get("transmission"), fuelType: formData.get("fuelType") || "PETROL", seats: formData.get("seats"),
    city: formData.get("city") || "Addis Ababa", neighbourhood: formData.get("neighbourhood"),
    pricePerDay: formData.get("pricePerDay"), description: formData.get("description"), photos,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  await db.car.update({ where: { id: carId }, data: parsed.data });
  refresh(carId);
  return { ok: true, message: "Listing updated. Existing bookings keep their original prices (BR-03)." };
}

/** FR-33: owner activates/deactivates an approved listing. */
export async function toggleCarActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const carId = String(formData.get("carId") ?? "");
  const car = await ownCar(carId, user.id);
  if (!car) return { error: "You can only manage your own listings." };
  if (car.status !== CarStatus.APPROVED && car.status !== CarStatus.INACTIVE) {
    return { error: "Only approved listings can be deactivated or re-activated (BR-02)." };
  }
  await db.car.update({ where: { id: carId }, data: { status: car.status === CarStatus.APPROVED ? CarStatus.INACTIVE : CarStatus.APPROVED } });
  refresh(carId);
  return { ok: true, message: car.status === CarStatus.APPROVED ? "Listing deactivated and hidden from the catalogue." : "Listing re-activated." };
}

/** FR-35: add blocked dates; dates clashing with active bookings are refused. */
export async function addBlockedDatesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const carId = String(formData.get("carId") ?? "");
  const car = await ownCar(carId, user.id);
  if (!car) return { error: "You can only manage your own listings." };
  const dates = [...new Set(formData.getAll("dates").map(String).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)))];
  if (dates.length === 0) return { error: "Pick at least one date to block." };

  const actives = await db.booking.findMany({ where: { carId, status: { in: BLOCKING_STATUSES } } });
  const blocked = new Set(car.unavailableDates.map(toISODate));
  const rejected: string[] = [];
  for (const dateStr of dates) {
    const day = new Date(dateStr + "T00:00:00.000Z");
    const clash = actives.some((b) => rangesOverlap(day, day, b.startDate, b.endDate));
    if (clash) rejected.push(dateStr);
    else blocked.add(dateStr);
  }
  await db.car.update({ where: { id: carId }, data: { unavailableDates: [...blocked].sort().map((s) => new Date(s + "T00:00:00.000Z")) } });
  refresh(carId);
  if (rejected.length === dates.length) return { error: "None of those dates could be blocked — they overlap active bookings." };
  return { ok: true, message: rejected.length ? `Blocked ${dates.length - rejected.length} date(s). ${rejected.length} overlapped active booking(s) and were refused.` : `Blocked ${dates.length} date(s).` };
}

/** FR-35: remove a blocked date; prevented when an active booking overlaps it. */
export async function removeBlockedDateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const carId = String(formData.get("carId") ?? "");
  const dateStr = String(formData.get("date") ?? "");
  const car = await ownCar(carId, user.id);
  if (!car) return { error: "You can only manage your own listings." };
  const day = new Date(dateStr + "T00:00:00.000Z");
  const actives = await db.booking.findMany({ where: { carId, status: { in: BLOCKING_STATUSES } } });
  if (actives.some((b) => rangesOverlap(day, day, b.startDate, b.endDate))) {
    return { error: "That date overlaps an active booking and cannot be unblocked." };
  }
  await db.car.update({ where: { id: carId }, data: { unavailableDates: car.unavailableDates.filter((d) => toISODate(d) !== dateStr) } });
  refresh(carId);
  return { ok: true, message: "Date unblocked." };
}
