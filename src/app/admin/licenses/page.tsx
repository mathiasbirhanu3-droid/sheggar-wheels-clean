// Admin — driving licence approvals (FR-50 / BR-08): renters submit their licence on
// /profile; ONLY the admin decides here. APPROVED unlocks self-drive on every car.
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { db } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth";
import { approveDrivingLicenseAction, rejectDrivingLicenseAction } from "@/actions/platform";
import { DrivingLicenseStatusBadge } from "@/components/status-badges";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/submit-button";
import { IdCard } from "lucide-react";
import { DrivingLicenseStatus } from "@prisma/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Driving licence approvals" };

export default async function AdminLicensesPage() {
  await requireActiveUser(); // the layout already enforced ADMIN

  const [pending, decided] = await Promise.all([
    db.user.findMany({
      where: { drivingLicenseStatus: DrivingLicenseStatus.PENDING },
      orderBy: { updatedAt: "asc" }, // longest-waiting first
      select: { id: true, name: true, email: true, drivingLicenseNumber: true, drivingLicenseDoc: true, drivingLicenseStatus: true },
    }),
    db.user.findMany({
      where: { drivingLicenseStatus: { in: [DrivingLicenseStatus.APPROVED, DrivingLicenseStatus.REJECTED] } },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, name: true, email: true, drivingLicenseNumber: true, drivingLicenseDoc: true, drivingLicenseStatus: true, drivingLicenseNote: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <AutoRefresh />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground"><Link href="/admin" className="hover:text-foreground">Admin console</Link> <span aria-hidden>/</span> Driving licences</nav>
      <h1 className="text-2xl font-bold">Driving licence approvals <span className="text-base font-normal text-muted-foreground">({pending.length} pending)</span></h1>
      <p className="text-sm text-muted-foreground">
        Approving a renter&apos;s licence unlocks <strong>self-drive</strong> bookings on every car. Bring-your-own-driver bookings carry the driver&apos;s licence on the booking itself — those are reviewed by the car owner, not here.
      </p>

      {pending.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">No licences waiting for review.</CardContent></Card>
      ) : (
        <ul className="space-y-3">
          {pending.map((u) => (
            <li key={u.id}>
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{u.name}</p>
                      <p className="text-sm text-muted-foreground">{u.email}</p>
                    </div>
                    <DrivingLicenseStatusBadge status={u.drivingLicenseStatus} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {u.drivingLicenseDoc ? (
                      <a href={u.drivingLicenseDoc} target="_blank" rel="noopener noreferrer" title="Open the licence photo full size" className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u.drivingLicenseDoc} alt={`Driving licence from ${u.name}`} className="h-24 w-32 max-w-full cursor-zoom-in rounded-md border object-cover" />
                      </a>
                    ) : (
                      <div className="flex h-24 w-32 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-[10px] text-muted-foreground">no photo</div>
                    )}
                    <div className="space-y-1 text-sm">
                      <p><span className="text-muted-foreground">Number:</span> <span className="font-mono font-medium">{u.drivingLicenseNumber ?? "—"}</span></p>
                      <p className="text-xs text-muted-foreground">Check the photo and number, then approve or reject below.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <form action={approveDrivingLicenseAction}>
                      <input type="hidden" name="userId" value={u.id} />
                      <SubmitButton size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">Approve — unlock self-drive</SubmitButton>
                    </form>
                    <form action={rejectDrivingLicenseAction} className="space-y-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <Textarea name="note" rows={2} maxLength={300} placeholder="Optional reason, e.g. photo is unreadable…" className="text-sm" />
                      <SubmitButton size="sm" variant="outline">Reject</SubmitButton>
                    </form>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {decided.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><IdCard className="h-4 w-4 text-brand" aria-hidden /> Recently decided</p>
            <ul className="divide-y text-sm">
              {decided.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium">{u.name} <span className="font-normal text-muted-foreground">· {u.drivingLicenseNumber ?? "—"}</span></span>
                  <span className="flex items-center gap-2">
                    <DrivingLicenseStatusBadge status={u.drivingLicenseStatus} />
                    {u.drivingLicenseNote && <span className="text-xs text-muted-foreground">{u.drivingLicenseNote}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
