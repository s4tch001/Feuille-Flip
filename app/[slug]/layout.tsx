import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getFlipbookBySlug } from "@/lib/flipbooks";

type LayoutProps = {
  children: ReactNode;
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-dynamic";

/**
 * This check lives outside the same segment's loading boundary. It lets Next.js
 * send a real HTTP 404 before streaming begins when a link has expired.
 */
export default async function FlipbookLayout({ children, params }: LayoutProps) {
  const { slug } = await params;
  const flipbook = await getFlipbookBySlug(slug).catch(() => null);
  if (!flipbook) notFound();

  return children;
}
