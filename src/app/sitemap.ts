import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { CarStatus } from "@prisma/client";
import { site, siteUrl } from "@/lib/site";

export const revalidate = 3600; // refresh at most hourly

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const statics: MetadataRoute.Sitemap = [
    { url: siteUrl("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: siteUrl("/cars"), lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: siteUrl("/signin"), lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: siteUrl("/signup"), lastModified: now, changeFrequency: "monthly", priority: 0.4 },
  ];

  try {
    const cars = await db.car.findMany({
      where: { status: CarStatus.APPROVED },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    return [
      ...statics,
      ...cars.map((c) => ({
        url: siteUrl(`/cars/${c.id}`),
        lastModified: c.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
    ];
  } catch {
    // Build-time cold start (no DB reachable yet): publish the static skeleton.
    return statics;
  }
}
