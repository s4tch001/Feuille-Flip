import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FlipbookViewer } from "@/components/flipbook-viewer";
import { getFlipbookBySlug } from "@/lib/flipbooks";

type PageProps = { params: Promise<{ slug: string }> };

// Retention is checked against the current time on every request. Never serve a
// cached viewer after its three-calendar-month publication window has ended.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const flipbook = await getFlipbookBySlug(slug).catch(() => null);
  if (!flipbook) return { title: "Flipbook not found", robots: { index: false, follow: false } };

  return {
    title: flipbook.title,
    description: `Flip through ${flipbook.title} online.`,
    alternates: { canonical: `/${flipbook.slug}` },
    openGraph: {
      type: "article",
      title: flipbook.title,
      description: `Flip through ${flipbook.title} online.`,
      url: `/${flipbook.slug}`,
    },
  };
}

export default async function FlipbookPage({ params }: PageProps) {
  const { slug } = await params;
  const flipbook = await getFlipbookBySlug(slug).catch(() => null);
  if (!flipbook) notFound();

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return <FlipbookViewer title={flipbook.title} pdfUrl={flipbook.pdfUrl} pageUrls={flipbook.pageUrls} pageWidth={flipbook.pageWidth} pageHeight={flipbook.pageHeight} shareUrl={new URL(`/${flipbook.slug}`, baseUrl).toString()} />;
}
