// Catalogue (FR-08..12): search + filters + sort + pagination, all mirrored in URL params.
import Link from "next/link";
import { db } from "@/lib/db";
import { CarStatus, type Prisma, type FuelType, type Transmission } from "@prisma/client";
import { BLOCKING_STATUSES, getActiveDiscountMap } from "@/lib/bookings";
import { rangesOverlap } from "@/lib/pricing";
import { CarCard } from "@/components/car-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchX, SlidersHorizontal } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Browse cars" };

const PAGE_SIZE = 6;
const SORTS = { "price-asc": "Price: low to high", "price-desc": "Price: high to low", newest: "Newest", popular: "Most reviewed" } as const;

type Params = { q?: string; neighbourhood?: string; transmission?: string; fuelType?: string; seats?: string; minPrice?: string; maxPrice?: string; start?: string; end?: string; sort?: string; page?: string };

export default async function CarsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const sort = (sp.sort && sp.sort in SORTS ? sp.sort : "newest") as keyof typeof SORTS;

  const where: Prisma.CarWhereInput = { status: CarStatus.APPROVED };
  if (sp.q?.trim()) {
    const q = sp.q.trim();
    where.OR = [{ make: { contains: q, mode: "insensitive" } }, { model: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { neighbourhood: { contains: q, mode: "insensitive" } }];
  }
  if (sp.neighbourhood?.trim()) where.neighbourhood = { contains: sp.neighbourhood.trim(), mode: "insensitive" };
  if (sp.transmission === "AUTOMATIC" || sp.transmission === "MANUAL") where.transmission = sp.transmission as Transmission;
  if (sp.fuelType && ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"].includes(sp.fuelType)) where.fuelType = sp.fuelType as FuelType;
  if (sp.seats === "2" || sp.seats === "4" || sp.seats === "5" || sp.seats === "7") where.seats = { gte: Number(sp.seats) };
  const min = Number(sp.minPrice); if (sp.minPrice && min > 0) where.pricePerDay = { ...(where.pricePerDay as object), gte: min };
  const max = Number(sp.maxPrice); if (sp.maxPrice && max > 0) where.pricePerDay = { ...(where.pricePerDay as object), lte: max };

  const orderBy: Prisma.CarOrderByWithRelationInput =
    sort === "price-asc" ? { pricePerDay: "asc" } : sort === "price-desc" ? { pricePerDay: "desc" } : sort === "popular" ? { bookings: { _count: "desc" } } : { createdAt: "desc" };

  const all = await db.car.findMany({ where, orderBy, include: { reviews: { select: { rating: true } }, bookings: { where: { status: { in: BLOCKING_STATUSES } }, select: { startDate: true, endDate: true } } } });

  // FR-09 availability filter: drop cars blocked in the requested range.
  let results = all;
  if (sp.start && sp.end) {
    const s = new Date(sp.start + "T00:00:00.000Z");
    const e = new Date(sp.end + "T00:00:00.000Z");
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && e >= s) {
      results = results.filter((car) => {
        const blocked = car.unavailableDates.some((b) => { const d = new Date(b.toISOString().slice(0, 10) + "T00:00:00.000Z"); return s <= d && d <= e; });
        return !blocked && !car.bookings.some((bk) => rangesOverlap(s, e, bk.startDate, bk.endDate));
      });
    }
  }

  const total = results.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clamped = Math.min(page, pages);
  const slice = results.slice((clamped - 1) * PAGE_SIZE, clamped * PAGE_SIZE);
  // ONE extra query for the whole page of cards (anti-N+1): carId -> live percent.
  const discountMap = await getActiveDiscountMap(slice.map((c) => c.id));

  const neighbourhoods = [...new Set((await db.car.findMany({ where: { status: CarStatus.APPROVED }, select: { neighbourhood: true } })).map((c) => c.neighbourhood))].sort();
  const qs = (over: Partial<Params>) => { const p = new URLSearchParams({ ...sp, ...Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined && v !== "")) } as Record<string, string>); p.set("page", "1"); return "/cars?" + p.toString(); };
  const pageQs = (p: number) => { const u = new URLSearchParams(Object.fromEntries(Object.entries(sp).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>); u.set("page", String(p)); return "/cars?" + u.toString(); };
  const active = Object.entries(sp).filter(([k, v]) => v && k !== "page" && k !== "sort").length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Browse cars <span className="text-base font-normal text-muted-foreground">({total} available)</span></h1>
        <p className="text-sm text-muted-foreground">Filters live in the URL — every view is shareable and reload-safe (FR-11).</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Filters */}
        <form action="/cars" method="get" className="space-y-4 self-start rounded-xl border p-4 lg:sticky lg:top-20">
          <input type="hidden" name="sort" value={sort} />
          <p className="flex items-center gap-2 font-semibold"><SlidersHorizontal className="h-4 w-4" /> Filters</p>
          <div className="space-y-1.5">
            <Label htmlFor="q">Search</Label>
            <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Make, model, area…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="neighbourhood">Neighbourhood</Label>
            <select id="neighbourhood" name="neighbourhood" defaultValue={sp.neighbourhood ?? ""} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">Any area</option>
              {neighbourhoods.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transmission">Transmission</Label>
            <select id="transmission" name="transmission" defaultValue={sp.transmission ?? ""} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">Any</option>
              <option value="AUTOMATIC">Automatic</option>
              <option value="MANUAL">Manual</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fuelType">Fuel type</Label>
            <select id="fuelType" name="fuelType" defaultValue={sp.fuelType ?? ""} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">Any</option>
              <option value="PETROL">Petrol</option>
              <option value="DIESEL">Diesel</option>
              <option value="HYBRID">Hybrid</option>
              <option value="ELECTRIC">Electric</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seats">Minimum seats</Label>
            <select id="seats" name="seats" defaultValue={sp.seats ?? ""} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">Any</option>
              <option value="2">2+</option>
              <option value="4">4+</option>
              <option value="5">5+</option>
              <option value="7">7+</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="minPrice">Min ETB/day</Label>
              <Input id="minPrice" name="minPrice" type="number" min={0} defaultValue={sp.minPrice ?? ""} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxPrice">Max ETB/day</Label>
              <Input id="maxPrice" name="maxPrice" type="number" min={0} defaultValue={sp.maxPrice ?? ""} placeholder="10000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="start">Available from</Label>
              <Input id="start" name="start" type="date" defaultValue={sp.start ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end">Until</Label>
              <Input id="end" name="end" type="date" defaultValue={sp.end ?? ""} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1 bg-brand text-brand-foreground hover:bg-brand/90">Apply</Button>
            {active > 0 && <Button asChild type="button" variant="outline"><Link href="/cars" aria-label={`Clear ${active} active filters`}>Reset</Link></Button>}
          </div>
        </form>

        {/* Results */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Sorted by <span className="font-medium text-foreground">{SORTS[sort].toLowerCase()}</span></p>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(SORTS) as (keyof typeof SORTS)[]).map((k) => (
                <Button key={k} asChild size="sm" variant={k === sort ? "secondary" : "ghost"}>
                  <Link href={qs({ sort: k })}>{SORTS[k]}</Link>
                </Button>
              ))}
            </div>
          </div>

          {slice.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <SearchX className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
              <p className="font-medium">No cars match your filters</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Try widening the price range, choosing another neighbourhood, or clearing the availability dates.</p>
              <Button asChild variant="outline" size="sm" className="mt-4"><Link href="/cars">Clear all filters</Link></Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {slice.map((car) => {
                const ratings = car.reviews.map((r) => r.rating);
                return <CarCard key={car.id} car={{ ...car, avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null, reviewsCount: ratings.length, discountPercent: discountMap.get(car.id) ?? null }} />;
              })}
            </div>
          )}

          {pages > 1 && (
            <nav aria-label="Pagination" className="flex items-center justify-center gap-1 pt-2">
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                <Button key={p} asChild size="sm" variant={p === clamped ? "secondary" : "ghost"} aria-current={p === clamped ? "page" : undefined}>
                  <Link href={pageQs(p)}>{p}</Link>
                </Button>
              ))}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
