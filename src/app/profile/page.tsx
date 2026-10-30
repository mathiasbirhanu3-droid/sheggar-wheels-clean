// Profile (FR-50): the renter's own driving licence — uploaded once, approved by an
// ADMIN. An APPROVED licence unlocks SELF_DRIVE bookings on every car; driver modes
// never need it. Also shows the account summary.
import Link from "next/link";
import { db } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth";
import { updateDrivingLicenseAction } from "@/actions/profile";
import { DrivingLicenseStatusBadge } from "@/components/status-badges";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { DocPicker } from "@/components/doc-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IdCard, CarFront, UserRound } from "lucide-react";
import type { DrivingLicenseStatus } from "@prisma/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "My profile" };

export default async function ProfilePage() {
  const session = await requireActiveUser();
  const user = await db.user.findUnique({
    where: { id: session.id },
    select: {
      name: true, email: true, phone: true, roles: true,
      drivingLicenseNumber: true, drivingLicenseDoc: true, drivingLicenseStatus: true, drivingLicenseNote: true,
    },
  });
  if (!user) return null;
  const status: DrivingLicenseStatus = user.drivingLicenseStatus;
  const locked = status === "APPROVED"; // approved — read-only until the admin changes it

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold">My profile</h1>
        <p className="text-sm text-muted-foreground">Your account and your driving licence — the key that unlocks self-drive bookings.</p>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2"><IdCard className="h-4 w-4 text-brand" aria-hidden /> Driving licence (for self-drive)</span>
            <DrivingLicenseStatusBadge status={status} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {status === "APPROVED" && (
            <div className="space-y-3">
              <p className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                <CarFront className="h-4 w-4 shrink-0" aria-hidden />
                Approved — you can book <strong>any car</strong> self-drive. The licence number is shared with owners at handover.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {user.drivingLicenseDoc && (
                  <a href={user.drivingLicenseDoc} target="_blank" rel="noopener noreferrer" title="Open the licence photo full size">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={user.drivingLicenseDoc} alt="Your driving licence on file" className="h-24 w-32 max-w-full cursor-zoom-in rounded-md border object-cover" />
                  </a>
                )}
                <p><span className="text-muted-foreground">Number:</span> <span className="font-mono font-medium">{user.drivingLicenseNumber ?? "—"}</span></p>
              </div>
              <p className="text-xs text-muted-foreground">Need a correction? Contact the platform admin — the licence stays locked while approved.</p>
            </div>
          )}

          {status === "PENDING" && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Under review by the platform admin — you&apos;ll get a notification when it&apos;s decided. You can already book with a driver meanwhile.
            </p>
          )}

          {status === "REJECTED" && (
            <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {user.drivingLicenseNote ? `Reason: ${user.drivingLicenseNote}` : "The submitted licence was not approved."} Upload a clearer photo below.
            </p>
          )}

          {!locked && (
            <ActionForm action={updateDrivingLicenseAction} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="drivingLicenseNumber">Licence number</Label>
                <Input
                  id="drivingLicenseNumber"
                  name="drivingLicenseNumber"
                  inputMode="text"
                  autoComplete="off"
                  placeholder="e.g. ET-DM-0031452"
                  minLength={4}
                  maxLength={40}
                  required
                  defaultValue={user.drivingLicenseNumber ?? ""}
                />
              </div>
              <DocPicker
                name="drivingLicenseDoc"
                label="Licence photo"
                description="Upload a clear photo or scan of your driving licence. The admin reviews it before unlocking self-drive; it stays private between you and the platform."
                required
                initial={status === "REJECTED" ? user.drivingLicenseDoc : null}
              />
              <SubmitButton className="bg-brand text-brand-foreground hover:bg-brand/90">
                {status === "NONE" ? "Submit licence for review" : "Re-submit licence"}
              </SubmitButton>
            </ActionForm>
          )}

          <p className="text-xs text-muted-foreground">
            Booking with a driver (your own or the owner&apos;s) never needs this licence — it is only the self-drive gate.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><UserRound className="h-4 w-4 text-brand" aria-hidden /> Account</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{user.name}</span></p>
          <p className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{user.email}</span></p>
          <p className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{user.phone ?? "—"}</span></p>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Roles</span>
            <span className="flex gap-1.5">{user.roles.map((r) => <Badge key={r} variant="secondary">{r.toLowerCase()}</Badge>)}</span>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        <Link href="/cars" className="text-brand hover:underline">Browse cars →</Link>
        <span className="mx-2" aria-hidden>·</span>
        The 10% platform fee applies to every booking — including any owner-driver fee.
      </p>
    </div>
  );
}
