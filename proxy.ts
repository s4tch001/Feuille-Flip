import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isFlipbookExpired } from "@/lib/flipbook-retention";

const RESERVED_SINGLE_SEGMENTS = new Set([
  "_not-found",
  "_next",
  "api",
  "apple-icon",
  "brand",
  "create",
  "favicon.ico",
  "icon.svg",
  "images",
  "robots.txt",
  "sitemap.xml",
]);
const PUBLIC_SLUG = /^[\p{Letter}\p{Number}](?:[\p{Letter}\p{Number}-]*[\p{Letter}\p{Number}])?$/u;
const NOT_FOUND_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Flipbook not found | Feuille Flip</title>
    <style>
      :root { color-scheme: light; font-family: Arial, sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; color: #29372d; background: #f4f1e8; }
      main { width: min(38rem, calc(100% - 3rem)); text-align: center; }
      span { color: #69746c; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      h1 { margin: 1rem 0 .75rem; font-family: Georgia, serif; font-size: clamp(2rem, 7vw, 4rem); }
      p { color: #59635c; font-size: 1.05rem; line-height: 1.7; }
      a { display: inline-flex; margin-top: 1rem; padding: .8rem 1.1rem; border-radius: 999px; color: white; background: #2f704d; font-weight: 700; text-decoration: none; }
      a:focus-visible { outline: 3px solid #1d5035; outline-offset: 3px; }
    </style>
  </head>
  <body>
    <main>
      <span>404 · Page not found</span>
      <h1>This flipbook isn't here.</h1>
      <p>The link may be incomplete, expired, or the flipbook may have been removed.</p>
      <a href="/">Create a flipbook</a>
    </main>
  </body>
</html>`;

function unavailableResponse(request: NextRequest) {
  return new NextResponse(request.method === "HEAD" ? null : NOT_FOUND_HTML, {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/**
 * Verify public flipbook availability before the route's loading boundary can
 * stream a 200 response. The page repeats the check as defense in depth.
 */
export async function proxy(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();

  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return NextResponse.next();

  let slug: string;
  try {
    slug = decodeURIComponent(segments[0]);
  } catch {
    return unavailableResponse(request);
  }
  if (RESERVED_SINGLE_SEGMENTS.has(slug)) return NextResponse.next();
  if (!PUBLIC_SLUG.test(slug)) return unavailableResponse(request);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !secretKey) {
    return new NextResponse("Service temporarily unavailable.", {
      status: 503,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase
    .from("flipbooks")
    .select("created_at")
    .eq("slug", slug)
    .maybeSingle<{ created_at: string }>();

  if (error) {
    return new NextResponse("Service temporarily unavailable.", {
      status: 503,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
  if (!data || isFlipbookExpired(data.created_at)) return unavailableResponse(request);

  return NextResponse.next();
}

export const config = {
  matcher: "/:slug",
};
