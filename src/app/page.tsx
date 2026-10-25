import Link from "next/link";
import { CalendarCheck, KeyRound, Search, ShieldCheck, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { CarCard } from "@/components/car-card";
import { AnnouncementTicker } from "@/components/announcement-ticker";
import { OffersBalloon } from "@/components/offers-balloon";
import { CarStatus, AnnouncementKind } from "@prisma/client";
import { getActiveDiscountMap } from "@/lib/bookings";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const now = new Date();
  const notExpired = { OR: [{ validUntil: null }, { validUntil: { gte: now } }] };
  const [featured, tickerItems, offers, approvedCount, neighbourhoods, completedTrips] = await Promise.all([
    db.car.findMany({
      where: { status: CarStatus.APPROVED },
      orderBy: { createdAt: "asc" },
      take: 6,
      include: { reviews: { select: { rating: true } }, owner: { select: { name: true } } },
    }),
    // Banner: every live announcement, newest first (DB does the expiry filtering — BR-12).
    db.announcement.findMany({
      where: { active: true, ...notExpired },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, title: true, kind: true, discountPercent: true, validUntil: true },
    }),
    // Balloon: discounts only (carId included so each offer can deep-link its car).
    db.announcement.findMany({
      where: { active: true, kind: AnnouncementKind.DISCOUNT, ...notExpired },
      orderBy: { discountPercent: "desc" },
      select: { id: true, title: true, body: true, discountPercent: true, validUntil: true, carId: true },
    }),
    db.car.count({ where: { status: CarStatus.APPROVED } }),
    db.car.findMany({ where: { status: CarStatus.APPROVED }, select: { neighbourhood: true }, distinct: ["neighbourhood"] }),
    db.booking.count({ where: { status: { in: ["COMPLETED", "REVIEWED", "RESOLVED"] } } }),
  ]);
  // ONE batch query badges every featured card (anti-N+1) — same map pattern as /cars.
  const discountMap = await getActiveDiscountMap(featured.map((c) => c.id));

  return (
    <>
      <AnnouncementTicker items={tickerItems} />

      <div className="mx-auto max-w-6xl px-4">
        {/* Hero */}
        <section className="py-12 text-center sm:py-16">
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">
            Rent a car from people you{" "}
            <span className="bg-gradient-to-r from-brand to-emerald-400 bg-clip-text text-transparent">trust</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Sheggar Wheels connects car owners and renters across Addis Ababa. Verified owners, escrow-held payments via TeleBirr, CBE Birr, M-Pesa & Chapa, and photo-documented handovers.
          </p>

          <form action="/cars" method="get" className="mx-auto mt-8 flex max-w-2xl flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm focus-within:ring-2 focus-within:ring-brand/40 sm:flex-row">
            <label className="sr-only" htmlFor="q">Search by make, model, or neighbourhood</label>
            <Input id="q" name="q" placeholder="Search make, model or neighbourhood…" className="sm:flex-1" />
            <Button type="submit" className="bg-brand text-brand-foreground hover:bg-brand/90">
              <Search className="mr-2 h-4 w-4" /> Search cars
            </Button>
          </form>

          <dl className="mx-auto mt-8 grid max-w-2xl grid-cols-3 gap-4 text-center">
            {[["Cars available", approvedCount], ["Neighbourhoods", neighbourhoods.length], ["Trips completed", completedTrips]].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="text-2xl font-bold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-it-works" className="pb-12">
          <h2 id="how-it-works" className="mb-6 text-center text-2xl font-bold">How it works</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { icon: Search, title: "1. Find a car", body: "Search by neighbourhood, price, transmission, and dates. Every listing shows the full price before you commit." },
              { icon: CalendarCheck, title: "2. Request and get approved", body: "Send a booking request. The owner approves, and your payment is held safely in escrow — not released until your trip completes." },
              { icon: KeyRound, title: "3. Drive and review", body: "Pick up the car with a photo-documented handover, drive, then leave the owner a public review for the next renter." },
            ].map((s) => (
              <Card key={s.title}>
                <CardContent className="p-6">
                  <s.icon className="mb-3 h-8 w-8 text-brand" aria-hidden />
                  <h3 className="mb-1 font-semibold">{s.title}</h3>
                  <p className="text-sm text-muted-foreground">{s.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Wallet className="h-4 w-4 text-brand" /> Money is held in escrow and labelled at every step — no surprises (BR-04, BR-12).
          </div>
        </section>

        {/* Featured cars */}
        <section aria-labelledby="featured" className="pb-16">
          <div className="mb-6 flex items-center justify-between">
            <h2 id="featured" className="text-2xl font-bold">Featured cars</h2>
            <Button asChild variant="ghost" size="sm"><Link href="/cars">View all →</Link></Button>
          </div>
          {featured.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">No cars are live yet. Owners are listing vehicles — check back soon.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((car) => {
                const ratings = car.reviews.map((r) => r.rating);
                const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
                return <CarCard key={car.id} car={{ ...car, avgRating: avg, reviewsCount: ratings.length, discountPercent: discountMap.get(car.id) ?? null }} />;
              })}
            </div>
          )}
        </section>

        {/* Owner CTA */}
        <section className="pb-16">
          <div className="rounded-xl bg-gradient-to-br from-brand to-brand/80 p-8 text-center text-brand-foreground shadow-xl shadow-brand/25">
            <ShieldCheck className="mx-auto mb-3 h-10 w-10" aria-hidden />
            <h2 className="text-2xl font-bold">Own a car? Turn idle days into income.</h2>
            <p className="mx-auto mt-2 max-w-xl text-brand-foreground/85">
              List your car, announce events and discounts from your owner hub, approve the requests you like, and watch your earnings grow. Moderation keeps the marketplace trustworthy.
            </p>
            <Button asChild variant="secondary" className="mt-4"><Link href="/signup">Become an owner</Link></Button>
          </div>
        </section>
      </div>

      <OffersBalloon offers={offers} />
    </>
  );
}
