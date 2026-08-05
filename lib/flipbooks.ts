import "server-only";

import { FLIPBOOK_BUCKET } from "@/lib/constants";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { cache } from "react";

export type Flipbook = {
  id: string;
  title: string;
  slug: string;
  pdfUrl?: string;
  pageUrls?: string[];
  pageWidth?: number;
  pageHeight?: number;
  createdAt: string;
};

type FlipbookRow = {
  id: string;
  title: string;
  slug: string;
  storage_path: string | null;
  page_paths: string[] | null;
  page_width: number | null;
  page_height: number | null;
  created_at: string;
};

export const getFlipbookBySlug = cache(async (slug: string): Promise<Flipbook | null> => {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("flipbooks")
    .select("id,title,slug,storage_path,page_paths,page_width,page_height,created_at")
    .eq("slug", slug)
    .maybeSingle<FlipbookRow>();

  if (error) throw new Error("Could not load this flipbook.");
  if (!data) return null;

  const pdfUrl = data.storage_path
    ? supabase.storage.from(FLIPBOOK_BUCKET).getPublicUrl(data.storage_path).data.publicUrl
    : undefined;
  const pageUrls = data.page_paths?.map((path) => supabase.storage.from(FLIPBOOK_BUCKET).getPublicUrl(path).data.publicUrl);

  return {
    id: data.id,
    title: data.title,
    slug: data.slug,
    pdfUrl,
    pageUrls,
    pageWidth: data.page_width ?? undefined,
    pageHeight: data.page_height ?? undefined,
    createdAt: data.created_at,
  };
});

export async function getRecentFlipbookSlugs(): Promise<Array<{ slug: string; createdAt: string }>> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("flipbooks")
    .select("slug,created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) return [];
  return (data ?? []).map((row) => ({ slug: row.slug, createdAt: row.created_at }));
}
