// Listing moderation (FR-40, BR-02).
import Link from "next/link";
import { db } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth";
import { formatETB } from "@/lib/pricing";
import { approveListingAction, rejectListingAction } from "@/actions/platform";
import { SubmitButton } from "@/components/submit-button";
import { CarImage } from "@/components/car-image";
import { CarStatusBadge } from "@/components/status-badges";
import { Card, CardContent } from "@/components/ui/card";
import { CarStatus } from "@prisma/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Moderate listings" };

export default async function AdminListingsPage() {
  await requireActiveUser();
  const cars = await db.car.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { owner: { select: { name: true } }, _count: { select: { bookings: true } } },
  });
  const order: Record<string, number> = { PENDING: 0, REJECTED: 1, APPROVED: 2, INACTIVE: 3, DRAFT: 4 };
  cars.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-bold">Listing moderation</h1>
      <p className="text-sm text-muted-foreground">Only approved listings appear publicly (BR-02).</p>
      <ul className="space-y-3">
        {cars.map((car) => (
          <li key={car.id}>
            <Card>
              <CardContent className="flex flex-wrap items-center gap-4 p-4">
                <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md"><CarImage src={car.photos[0]} alt={`${car.make} ${car.model}`} className="absolute inset-0 h-full w-full" /></div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">{car.make} {car.model} {car.year} <CarStatusBadge status={car.status} /></p>
                  <p className="text-sm text-muted-foreground">by {car.owner.name} · {car.neighbourhood} · {formatETB(car.pricePerDay)}/day · {car._count.bookings} bookings</p>
                </div>
                <div className="flex gap-2">
                  {car.status !== CarStatus.APPROVED && (
                    <form action={approveListingAction}><input type="hidden" name="carId" value={car.id} /><SubmitButton size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">Approve</SubmitButton></form>
                  )}
                  {car.status !== CarStatus.REJECTED && car.status !== CarStatus.INACTIVE && (
                    <form action={rejectListingAction}><input type="hidden" name="carId" value={car.id} /><SubmitButton size="sm" variant="outline">Reject</SubmitButton></form>
                  )}
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground"><Link href="/admin" className="text-brand hover:underline">← Admin console</Link></p>
    </div>
  );
}
