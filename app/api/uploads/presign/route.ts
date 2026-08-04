import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { FLIPBOOK_BUCKET } from "@/lib/constants";
import { getClientIp, hasTrustedOrigin, isRateLimited } from "@/lib/request-security";
import { presignUploadSchema } from "@/lib/schemas";
import { slugifyTitle } from "@/lib/slug";
import { createSupabaseAdmin, getSupabaseSecret } from "@/lib/supabase/server";
import { createUploadTicket } from "@/lib/upload-ticket";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return apiError(403, "UNTRUSTED_ORIGIN", "This upload request was not accepted.");
  }
  if (isRateLimited(`presign:${getClientIp(request)}`)) {
    return apiError(429, "RATE_LIMITED", "Too many upload attempts. Please wait a minute.");
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

  const parsed = presignUploadSchema.safeParse(input);
  if (!parsed.success) {
    return apiError(422, "INVALID_UPLOAD", parsed.error.issues[0]?.message ?? "Invalid upload.");
  }

  try {
    const supabase = createSupabaseAdmin();
    const slug = slugifyTitle(parsed.data.title);
    const { data: existing, error: lookupError } = await supabase
      .from("flipbooks")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (existing) {
      return apiError(409, "SLUG_TAKEN", "That title is already in use. Try a more specific title.");
    }

    const storagePath = `uploads/${randomUUID()}.pdf`;
    const { data: signedUpload, error: uploadError } = await supabase.storage
      .from(FLIPBOOK_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });

    if (uploadError || !signedUpload) throw uploadError ?? new Error("No upload token returned.");

    const ticket = createUploadTicket(
      {
        title: parsed.data.title,
        slug,
        storagePath,
        fileSize: parsed.data.fileSize,
      },
      getSupabaseSecret(),
    );

    return NextResponse.json(
      {
        slug,
        storagePath,
        storageToken: signedUpload.token,
        ticket,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return apiError(500, "UPLOAD_SETUP_FAILED", "Upload could not be started. Please try again.");
  }
}
