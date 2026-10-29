import Link from "next/link";
import { CalendarCheck, KeyRound, ShieldCheck, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CarCard } from "@/components/car-card";
import { AnnouncementTicker } from "@/components/announcement-ticker";
import { OffersBalloon } from "@/components/offers-balloon";
import { HomeHero } from "@/components/home-hero";
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
        {/* Hero — split layout, illustrated, zero client JS */}
        <HomeHero approvedCount={approvedCount} neighbourhoods={neighbourhoods.map((n) => n.neighbourhood)} completedTrips={completedTrips} />

        {/* How it works */}
        <section aria-labelledby="how-it-works" className="pb-14 pt-4">
          <h2 id="how-it-works" className="mb-6 text-center text-2xl font-bold">How it works</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { icon: SearchMini, title: "Find a car", body: "Filter by neighbourhood, price, transmission and dates. The full price is shown before you commit." },
              { icon: CalendarCheck, title: "Request & get approved", body: "Send a request — the owner approves and your payment waits safely in escrow, released only after your trip." },
              { icon: KeyRound, title: "Drive & review", body: "Pick up the keys with a photo-documented handover, enjoy the drive, then review the owner for the next renter." },
            ].map((s, i) => (
              <Card key={s.title} className="relative">
                <CardContent className="p-6">
                  <span className="absolute right-4 top-4 font-mono text-3xl font-semibold text-brand/15" aria-hidden>0{i + 1}</span>
                  <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10">
                    <s.icon className="h-5 w-5 text-brand" aria-hidden />
                  </span>
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
          <div className="grid items-center gap-6 rounded-2xl bg-gradient-to-br from-brand to-brand/80 p-8 text-brand-foreground shadow-xl shadow-brand/25 sm:grid-cols-[1fr_auto] sm:p-10">
            <div>
              <h2 className="text-2xl font-bold">Own a car? Turn idle days into income.</h2>
              <p className="mt-2 max-w-xl text-brand-foreground/85">
                List your car, approve the requests you like, and track earnings from your owner hub — admin moderation keeps the marketplace trustworthy.
              </p>
            </div>
            <Button asChild variant="secondary" size="lg" className="justify-self-start sm:justify-self-end">
              <Link href="/signup" className="gap-2"><ShieldCheck className="h-4 w-4" aria-hidden /> Become an owner</Link>
            </Button>
          </div>
        </section>
      </div>

      <OffersBalloon offers={offers} />
    </>
  );
}

function SearchMini() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}
