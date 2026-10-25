"use client";
// Booking form with live, client-side totals mirror of the server snapshot (FR-14/18, BR-04/05).
// Every request must include the renter's DRIVING LICENCE (number + photo) — the car owner
// reviews it in their dashboard and decides approve/reject. The server re-validates everything;
// these checks are a UX fast path only (NFR-10).
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import Image from "next/image";
import { requestBookingAction } from "@/actions/bookings";
import { computeTotals, formatETB, toISODate } from "@/lib/pricing";
import { SubmitButton } from "@/components/submit-button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CalendarX, IdCard, X } from "lucide-react";

type Props = {
  carId: string;
  pricePerDay: number;
  blockedDates: string[]; // ISO dates blocked by owner or active bookings
  signedIn: boolean;
  suspended?: boolean;
  discountPercent?: number | null; // live offer for this car — mirror of the server rule
};

// Resize any device photo to a small JPEG data URL (max 1280px edge, q0.82) so the
// request body stays tiny — same pipeline as the owner photo picker (13-n).
async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function BookingForm({ carId, pricePerDay, blockedDates, signedIn, suspended, discountPercent }: Props) {
  const [state, formAction] = useActionState(requestBookingAction, {});
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseImage, setLicenseImage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const today = toISODate(new Date());

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file after a remove
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file (JPG or PNG).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("That photo is too large — pick one under 8 MB.");
      return;
    }
    try {
      setLicenseImage(await fileToDataUrl(file));
    } catch {
      toast.error("Could not read that image — try another file.");
    }
  }

  const blockedSet = new Set(blockedDates);
  const pct = Number.isFinite(discountPercent) && discountPercent! > 0 ? Math.min(Math.round(discountPercent!), 100) : 0;
  let check: { ok: boolean; msg: string; totals: ReturnType<typeof computeTotals> | null };
  {
    if (!start || !end) check = { ok: false, msg: "Pick both a start and a return date.", totals: null };
    else {
      const s = new Date(start + "T00:00:00.000Z");
      const e = new Date(end + "T00:00:00.000Z");
      if (s.getTime() < new Date(today + "T00:00:00.000Z").getTime()) check = { ok: false, msg: "The start date cannot be in the past.", totals: null };
      else if (e.getTime() < s.getTime()) check = { ok: false, msg: "The return date cannot be before the start date.", totals: null };
      else {
        let clash = false;
        for (let d = new Date(s); d.getTime() <= e.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
          if (blockedSet.has(toISODate(d))) { clash = true; break; }
        }
        if (clash) check = { ok: false, msg: "Some selected days are unavailable. Adjust your range.", totals: null };
        else check = { ok: true, msg: "", totals: computeTotals(pricePerDay, s, e, pct)! };
      }
    }
  }
  const licenseOk = licenseNumber.trim().length >= 4 && licenseImage.length > 50;

  if (!signedIn) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Sign in as a demo renter to request this car.</p>
        <SubmitButton disabled>
          <CalendarX className="mr-2 h-4 w-4" /> Request booking
        </SubmitButton>
        <p className="text-sm">
          <Link href={`/signin?next=/cars/${carId}`} className="font-medium text-brand underline-offset-4 hover:underline">Sign in</Link> or{" "}
          <Link href="/signup" className="font-medium text-brand underline-offset-4 hover:underline">create an account</Link> to book.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="carId" value={carId} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="startDate">Pickup</Label>
          <Input id="startDate" name="startDate" type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="endDate">Return</Label>
          <Input id="endDate" name="endDate" type="date" min={start || today} value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
      </div>

      {check.msg && check.totals === null && (
        <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{check.msg}</AlertDescription></Alert>
      )}

      {check.totals && (
        <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm" aria-live="polite">
          <p className="flex justify-between"><span>{check.totals.days} day{check.totals.days > 1 ? "s" : ""} × {formatETB(pricePerDay)}</span><span>{formatETB(check.totals.subtotal)}</span></p>
          {check.totals.discountPercent > 0 && (
            <p className="flex items-center justify-between font-medium text-brand">
              <span className="flex items-center gap-1.5">
                <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-extrabold text-brand-foreground">−{check.totals.discountPercent}%</span>
                Live offer
              </span>
              <span>−{formatETB(check.totals.discountAmount)}</span>
            </p>
          )}
          <p className="flex justify-between text-muted-foreground"><span>Platform fee (10%)</span><span>{formatETB(check.totals.fee)}</span></p>
          <p className="flex justify-between border-t pt-1 font-semibold"><span>Total</span><span>{formatETB(check.totals.total)}</span></p>
          <p className="pt-1 text-xs text-muted-foreground">This exact total is snapshotted at request time — later price edits never change it (BR-03). The discount is frozen with it.</p>
        </div>
      )}

      {/* Driving licence — required with the request; the owner reviews it before approving. */}
      <fieldset className="space-y-2 rounded-lg border p-3">
        <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold"><IdCard className="h-4 w-4 text-brand" aria-hidden /> Driving licence</legend>
        <p className="text-xs text-muted-foreground">The owner checks your licence before approving the request. It stays private between you and the owner.</p>
        <div className="space-y-1.5">
          <Label htmlFor="licenseNumber">Licence number</Label>
          <Input
            id="licenseNumber"
            name="licenseNumber"
            inputMode="text"
            autoComplete="off"
            placeholder="e.g. ET-DM-0031452"
            minLength={4}
            maxLength={40}
            required
            value={licenseNumber}
            onChange={(e) => setLicenseNumber(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="licenseImageFile">Licence photo</Label>
          {licenseImage ? (
            <div className="flex items-center gap-3">
              <Image src={licenseImage} alt="Your driving licence" width={64} height={48} unoptimized className="h-12 w-16 rounded-md border object-cover" />
              <p className="flex-1 text-xs text-muted-foreground">Attached — the owner will see this with your request.</p>
              <button type="button" onClick={() => setLicenseImage("")} aria-label="Remove licence photo" className="rounded-md border p-1.5 text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : (
            <>
              <input
                ref={fileRef}
                id="licenseImageFile"
                type="file"
                accept="image/*"
                onChange={onPickFile}
                className="w-full cursor-pointer rounded-md border border-input bg-background text-sm file:mr-3 file:cursor-pointer file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/80"
                required
              />
              <p className="text-xs text-muted-foreground">JPG or PNG. Large phone photos are resized automatically in your browser.</p>
            </>
          )}
        </div>
        {/* The action contract: the data URL travels in this hidden input. */}
        <input type="hidden" name="licenseImage" value={licenseImage} />
      </fieldset>

      <SubmitButton disabled={!check.ok || !licenseOk || suspended}>Request booking</SubmitButton>
      {state.ok && state.message && <p className="text-sm text-brand">{state.message}</p>}
      {suspended && <p className="text-sm text-red-600">Your account is suspended — actions are disabled (FR-06).</p>}
      <p className="text-xs text-muted-foreground">You will not be charged until the owner approves and you complete the escrow checkout.</p>
    </form>
  );
}
