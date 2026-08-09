import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { getClientIp, hasTrustedOrigin, isRateLimited } from "@/lib/request-security";
import { checkPublicNameSchema } from "@/lib/schemas";
import { slugifyTitle } from "@/lib/slug";
import { createSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return apiError(403, "UNTRUSTED_ORIGIN", "This publishing request was not accepted.");
  }
  const clientIp = getClientIp(request);
  if (isRateLimited(`check-name:${clientIp}`)) {
    return apiError(429, "RATE_LIMITED", "Too many file-name checks. Please wait a minute.");
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return apiError(415, "UNSUPPORTED_MEDIA_TYPE", "Expected a JSON request.");
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "The request could not be read.");
  }

  const parsed = checkPublicNameSchema.safeParse(input);
  if (!parsed.success) {
    return apiError(422, "INVALID_PUBLIC_NAME", parsed.error.issues[0]?.message ?? "Invalid file name.");
  }

  const slug = slugifyTitle(parsed.data.publicFileName);
  try {
    const { data: existing, error } = await createSupabaseAdmin()
      .from("flipbooks")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (error) throw error;
    if (existing) {
      return apiError(409, "SLUG_TAKEN", "That file name is already in use. Choose another.");
    }

    return NextResponse.json(
      { available: true, slug },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return apiError(503, "NAME_CHECK_UNAVAILABLE", "File-name availability could not be checked. Please try again.");
  }
}
