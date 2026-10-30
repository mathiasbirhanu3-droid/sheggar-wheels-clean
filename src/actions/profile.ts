"use server";
// FR-50: the renter's own driving licence — uploaded once on /profile, reviewed
// by an ADMIN on /admin/licenses. APPROVED unlocks SELF_DRIVE bookings on every
// car; PENDING/REJECTED/NONE blocks self-drive but never blocks driver modes.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth";
import { notifyAdmins } from "@/lib/notifications";
import { drivingLicenseSchema, type ActionState } from "@/lib/validation";
import { rateLimit, scopedKey } from "@/lib/rate-limit";
import { DrivingLicenseStatus } from "@prisma/client";

/** Submit (or re-submit after a rejection) the renter's driving licence.
 *  Every submission resets the status to PENDING for a fresh admin review. */
export async function updateDrivingLicenseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireActiveUser();
  const rl = rateLimit(await scopedKey("license"), 5, 60_000); // 5 submissions / min / IP (spam guard)
  if (!rl.ok) return { error: `Too many attempts — try again in ${rl.retryAfterSec}s.` };
  const parsed = drivingLicenseSchema.safeParse({
    drivingLicenseNumber: formData.get("drivingLicenseNumber"),
    drivingLicenseDoc: formData.get("drivingLicenseDoc"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  await db.user.update({
    where: { id: user.id },
    data: {
      drivingLicenseNumber: parsed.data.drivingLicenseNumber,
      drivingLicenseDoc: parsed.data.drivingLicenseDoc,
      drivingLicenseStatus: DrivingLicenseStatus.PENDING,
      drivingLicenseNote: null, // clear a previous rejection note
    },
  });
  await notifyAdmins("Driving licence awaiting approval", `${user.name} submitted a driving licence for review — approving it unlocks self-drive bookings.`, "/admin/licenses");
  revalidatePath("/profile");
  revalidatePath("/admin/licenses");
  return { ok: true, message: "Licence submitted — the admin will review it shortly. You can already book with a driver meanwhile." };
}
