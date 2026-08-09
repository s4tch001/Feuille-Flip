import type { MetadataRoute } from "next";

import { getRecentFlipbookSlugs } from "@/lib/flipbooks";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const flipbooks = await getRecentFlipbookSlugs().catch(() => []);
  return [
    { url: siteUrl, lastModified: new Date(), changeFrequency: "monthly", priority: 1 },
    ...flipbooks.map((flipbook) => ({
      url: new URL(`/${flipbook.slug}`, siteUrl).toString(),
      lastModified: new Date(flipbook.createdAt),
      changeFrequency: "yearly" as const,
      priority: 0.7,
    })),
  ];
}
