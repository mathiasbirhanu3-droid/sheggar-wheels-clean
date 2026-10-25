// Per-car bookings (FR-36): review the submitted driving licence, approve/decline requests
// (BR-05), advance lifecycle. The licence decision is part of the owner's approve/decline.
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth";
import { formatETB, formatDate, formatDateTime } from "@/lib/pricing";
import { BookingStatusBadge, PaymentStatusBadge, LicenseStatusBadge } from "@/components/status-badges";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { approveBookingAction, declineBookingAction, startTripAction, completeTripAction } from "@/actions/bookings";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { canTransition } from "@/lib/bookings";
import { IdCard } from "lucide-react";
import { BookingStatus } from "@prisma/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Car bookings" };

export default async function CarBookingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  const car = await db.car.findUnique({ where: { id } });
  if (!car || car.ownerId !== user.id) notFound();

  const bookings = await db.booking.findMany({ where: { carId: id }, orderBy: { createdAt: "desc" }, include: { renter: { select: { id: true, name: true } } } });

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground"><Link href="/owner/cars" className="hover:text-foreground">My listings</Link> <span aria-hidden>/</span> {car.make} {car.model} bookings</nav>
      <h1 className="text-2xl font-bold">Requests and bookings <span className="text-base font-normal text-muted-foreground">({bookings.length})</span></h1>

      {bookings.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">No bookings for this car yet.</CardContent></Card>
      ) : (
        <ul className="space-y-3">
          {bookings.map((b) => (
            <li key={b.id}>
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{b.renter.name}</p>
                      <p className="text-sm text-muted-foreground">{formatDate(b.startDate)} → {formatDate(b.endDate)} · {b.days} day{b.days > 1 ? "s" : ""} · requested {formatDateTime(b.createdAt)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <BookingStatusBadge status={b.status} />
                      <PaymentStatusBadge status={b.paymentStatus} />
                      <p className="font-bold">{formatETB(b.total)}</p>
                    </div>
                  </div>

                  {/* Driving licence submitted with the request — review before approving. */}
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><IdCard className="h-4 w-4 text-brand" aria-hidden /> Driving licence</p>
                    {b.licenseNumber || b.licenseImage ? (
                      <div className="flex flex-wrap items-center gap-3">
                        {b.licenseImage ? (
                          <a href={b.licenseImage} target="_blank" rel="noopener noreferrer" title="Open the licence photo full size" className="shrink-0">
                            <Image src={b.licenseImage} alt={`Driving licence from ${b.renter.name}`} width={96} height={72} unoptimized className="h-[72px] w-24 cursor-zoom-in rounded-md border object-cover" />
                          </a>
                        ) : (
                          <div className="flex h-[72px] w-24 shrink-0 items-center justify-center rounded-md border bg-background text-[10px] text-muted-foreground">no photo</div>
                        )}
                        <div className="min-w-0 space-y-1 text-sm">
                          <p><span className="text-muted-foreground">Number:</span> <span className="font-mono font-medium">{b.licenseNumber ?? "—"}</span></p>
                          <LicenseStatusBadge status={b.licenseStatus} />
                          {b.licenseStatus === "PENDING" && b.status === "REQUESTED" && <p className="text-xs text-muted-foreground">Check the photo and number, then approve or decline below.</p>}
                          {b.licenseDecisionNote && <p className="text-xs text-muted-foreground">Decision note: {b.licenseDecisionNote}</p>}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No licence on file (older request created before this feature).</p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {canTransition(b.status, BookingStatus.CONFIRMED) && (
                      <>
                        <ActionForm action={approveBookingAction}><input type="hidden" name="bookingId" value={b.id} /><SubmitButton size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">Approve</SubmitButton></ActionForm>
                        <ActionForm action={declineBookingAction} className="space-y-2">
                          <input type="hidden" name="bookingId" value={b.id} />
                          <Textarea name="licenseDecisionNote" rows={2} maxLength={300} placeholder="Optional reason, e.g. licence photo is unreadable…" className="text-sm" />
                          <SubmitButton size="sm" variant="outline">Decline</SubmitButton>
                        </ActionForm>
                      </>
                    )}
                    {canTransition(b.status, BookingStatus.IN_PROGRESS) && (
                      <ActionForm action={startTripAction}><input type="hidden" name="bookingId" value={b.id} /><SubmitButton size="sm" variant="secondary">Start trip</SubmitButton></ActionForm>
                    )}
                    {canTransition(b.status, BookingStatus.COMPLETED) && (
                      <ActionForm action={completeTripAction}><input type="hidden" name="bookingId" value={b.id} /><SubmitButton size="sm" variant="secondary">Complete trip</SubmitButton></ActionForm>
                    )}
                    <Button asChild size="sm" variant="ghost"><Link href={"/bookings/" + b.id}>Details</Link></Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
