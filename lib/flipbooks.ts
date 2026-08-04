import "server-only";

import { FLIPBOOK_BUCKET } from "@/lib/constants";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { cache } from "react";

export type Flipbook = {
  id: string;
  title: string;
  slug: string;
  pdfUrl: string;
  createdAt: string;
};

type FlipbookRow = {
  id: string;
  title: string;
  slug: string;
  storage_path: string;
  created_at: string;
};

export const getFlipbookBySlug = cache(async (slug: string): Promise<Flipbook | null> => {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("flipbooks")
    .select("id,title,slug,storage_path,created_at")
    .eq("slug", slug)
    .maybeSingle<FlipbookRow>();

  if (error) throw new Error("Could not load this flipbook.");
  if (!data) return null;

  const { data: publicUrl } = supabase.storage
    .from(FLIPBOOK_BUCKET)
    .getPublicUrl(data.storage_path);

  return {
    id: data.id,
    title: data.title,
    slug: data.slug,
    pdfUrl: publicUrl.publicUrl,
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
