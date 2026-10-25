// Zod validation for every mutating flow (NFR-10, FR-32..35).
import { z } from "zod";
import {
  firstPasswordProblem,
  passwordContainsIdentity,
  passwordChecks,
} from "@/lib/password-policy";

// Sign-in (v3): email + password. Strength rules apply at CREATION only —
// here a password just has to be present, or legacy/Google-only accounts
// would be un-signable.
export const signInSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

// Sign-up (v3): account creation now requires a STRONG password, typed twice.
// The shared rule engine (lib/password-policy) is evaluated per-check so the
// server rejects exactly what the live checklist flags.
export const signUpSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters."),
    email: z.string().email("Enter a valid email address."),
    phone: z.string().min(7, "Enter a valid phone number.").max(20).optional().or(z.literal("")),
    password: z.string().superRefine((pw, ctx) => {
      const problem = firstPasswordProblem(pw);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
    confirmPassword: z.string().min(1, "Re-type the password to confirm it."),
    asOwner: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.password !== v.confirmPassword) {
      ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords do not match." });
    }
    // Contextual strength: the password must not embed the person's own
    // email or name — the first thing an attacker who saw one tries on the other.
    if (passwordContainsIdentity(v.password, v.email, v.name)) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Password must not contain your email or name.",
      });
    }
  });

/** UI helper: which strong-rules currently pass (drives the live checklist). */
export function signUpPasswordChecks(pw: string) {
  return passwordChecks(pw);
}

// A rental request must carry the renter's driving licence — the car owner
// reviews it in the owner dashboard and decides approve/reject.
export const bookingSchema = z.object({
  carId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a return date."),
  licenseNumber: z
    .string()
    .trim()
    .min(4, "Enter your driving licence number (at least 4 characters).")
    .max(40, "Licence number is too long."),
  licenseImage: z
    .string()
    .min(50, "Upload a photo of your driving licence.")
    .max(3_000_000, "Licence photo is too large — pick a smaller file.")
    .refine((v) => v.startsWith("data:image/") || v.startsWith("https://"), {
      message: "Licence photo must be an uploaded image.",
    }),
});

export const reviewSchema = z.object({
  bookingId: z.string().min(1),
  rating: z.coerce.number().int().min(1, "Pick a rating from 1 to 5.").max(5),
  comment: z.string().min(5, "Tell others a bit more (at least 5 characters).").max(1000),
});

export const replySchema = z.object({
  reviewId: z.string().min(1),
  reply: z.string().min(3, "Reply must be at least 3 characters.").max(500),
});

export const carSchema = z.object({
  make: z.string().min(2, "Make is required."),
  model: z.string().min(1, "Model is required."),
  year: z.coerce.number().int().min(1990, "Year must be 1990 or later.").max(new Date().getFullYear() + 1),
  transmission: z.enum(["AUTOMATIC", "MANUAL"]),
  fuelType: z.enum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]),
  seats: z.coerce.number().int().min(2).max(9),
  city: z.string().min(2).default("Addis Ababa"),
  neighbourhood: z.string().min(2, "Neighbourhood is required."),
  pricePerDay: z.coerce.number().int().min(500, "Price must be at least ETB 500/day.").max(100000),
  description: z.string().min(20, "Describe the car in at least 20 characters.").max(2000),
  // FR-34 (v2): a photo is either an https image link the owner pasted, or a
  // device upload stored as a data:image/...;base64 URL (browser-resized).
  // Per-item length cap ≈ 2.2 MB of image data — belt in case JS resizing was bypassed.
  photos: z
    .array(
      z
        .string()
        .max(3_000_000, "One of the photos is too large — please use a smaller image.")
        .refine(
          (v) =>
            /^https:\/\/\S+$/.test(v) ||
            /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v),
          "Each photo must be an https image link or an uploaded photo."
        )
    )
    .min(1, "Add at least one photo.")
    .max(5, "A car can have at most 5 photos."),
});

export const disputeSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().min(15, "Explain the issue in at least 15 characters.").max(1000),
});

export const resolveDisputeSchema = z.object({
  disputeId: z.string().min(1),
  notes: z.string().min(10, "Record resolution notes (at least 10 characters).").max(1000),
});

export const announcementSchema = z.object({
  title: z.string().min(4, "Title must be at least 4 characters.").max(120),
  body: z.string().min(10, "Body must be at least 10 characters.").max(1000),
});

// Payment (FR-23/24): method comes from the registry in lib/payments.ts. The
// contact field is validated CONDITIONALLY — wallets need an Ethiopian mobile,
// while Chapa (gateway) accepts an email OR a mobile for the receipt.
export const paymentSchema = z
  .object({
    bookingId: z.string().min(1),
    method: z.enum(["telebirr", "cbebirr", "mpesa", "chapa"]),
    contact: z.string().trim().min(5, "Enter your payment contact details.").max(60),
  })
  .superRefine((v, ctx) => {
    const phone = v.contact.replace(/[\s\-()]/g, "");
    const isPhone = /^(\+251|0)?9\d{8}$/.test(phone);
    if (v.method === "chapa") {
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.contact);
      if (!isPhone && !isEmail) ctx.addIssue({ code: "custom", message: "Enter the email or mobile number registered with Chapa." });
    } else if (!isPhone) {
      ctx.addIssue({ code: "custom", message: "Enter a valid Ethiopian mobile number (09xxxxxxxx)." });
    }
  });

export type ActionState = { ok?: boolean; error?: string; message?: string };
