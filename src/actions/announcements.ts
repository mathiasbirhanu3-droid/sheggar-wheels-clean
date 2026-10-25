"use server";
// Owner-submitted announcements (events + discounts) — FR-44 extension.
// Moderation gate (BR-02 pattern, third door): owners submit as `active: false`,
// an admin publishes from /admin/announcements. No owner content goes live unreviewed.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import type { ActionState } from "@/lib/validation";

export async function createOwnerAnnouncementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const owner = await requireRole("OWNER");

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  const percent = Number(formData.get("discountPercent"));
  const carId = String(formData.get("carId") ?? "").trim();
  const untilRaw = String(formData.get("validUntil") ?? "").trim();

  if (title.length < 4 || title.length > 120) return { error: "Title must be between 4 and 120 characters." };
  if (body.length < 10 || body.length > 400) return { error: "Describe it in 10-400 characters — include the rules (who qualifies, minimum days, etc.)." };
  if (kind !== "EVENT" && kind !== "DISCOUNT") return { error: "Choose event or discount." };
  if (kind === "DISCOUNT" && (!Number.isInteger(percent) || percent < 5 || percent > 70)) {
    return { error: "Discount must be a whole number between 5 and 70 percent." };
  }

  // A DISCOUNT must target exactly one car — that link is what puts the −N%
  // badge on its card and applies the maths to its bookings (BR-11: verify
  // ownership server-side; the <select> options are not trusted either).
  let targetCarId: string | null = null;
  if (kind === "DISCOUNT") {
    if (!carId) return { error: "Pick which of your cars the discount applies to." };
    const car = await db.car.findUnique({ where: { id: carId }, select: { ownerId: true } });
    if (!car || car.ownerId !== owner.id) return { error: "That car is not one of yours — pick a car from your own listings." };
    targetCarId = carId;
  }

  let validUntil: Date | null = null;
  if (untilRaw) {
    validUntil = new Date(untilRaw + "T23:59:59.000Z");
    if (isNaN(validUntil.getTime()) || validUntil.getTime() < Date.now()) {
      return { error: "The end date must be today or later." };
    }
  }

  await db.announcement.create({
    data: {
      title,
      body,
      kind,
      discountPercent: kind === "DISCOUNT" ? percent : null,
      carId: targetCarId,
      validUntil,
      active: false, // moderation gate: admin publishes
      createdById: owner.id,
    },
  });

  revalidatePath("/owner");
  revalidatePath("/admin/announcements");
  return { ok: true, message: "Sent to the admin for approval — it joins the home banner once approved." };
}
