import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { FLIPBOOK_BUCKET, MAX_PDF_BYTES } from "@/lib/constants";
import { getClientIp, hasTrustedOrigin, isRateLimited } from "@/lib/request-security";
import { completeUploadSchema } from "@/lib/schemas";
import { createSupabaseAdmin, getSupabaseSecret } from "@/lib/supabase/server";
import { verifyUploadTicket } from "@/lib/upload-ticket";

export const runtime = "nodejs";

async function removeInvalidUpload(storagePath: string) {
  try {
    await createSupabaseAdmin().storage.from(FLIPBOOK_BUCKET).remove([storagePath]);
  } catch {
    // A failed cleanup is intentionally hidden from the external response.
  }
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return apiError(403, "UNTRUSTED_ORIGIN", "This upload request was not accepted.");
  }
  if (isRateLimited(`complete:${getClientIp(request)}`)) {
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

  const parsed = completeUploadSchema.safeParse(input);
  let secret: string | undefined;
  try {
    secret = getSupabaseSecret();
  } catch {
    secret = undefined;
  }
  const payload = parsed.success && secret ? verifyUploadTicket(parsed.data.ticket, secret) : null;
  if (!payload || !/^uploads\/[0-9a-f-]{36}\.pdf$/.test(payload.storagePath)) {
    return apiError(400, "INVALID_TICKET", "The upload expired or is invalid. Please start again.");
  }

  const supabase = createSupabaseAdmin();
  const fileName = payload.storagePath.split("/").at(-1)!;
  const { data: objects, error: listError } = await supabase.storage
    .from(FLIPBOOK_BUCKET)
    .list("uploads", { search: fileName, limit: 2 });
  const object = objects?.find((item) => item.name === fileName);
  const actualSize = Number(object?.metadata?.size ?? 0);
  const mimeType = String(object?.metadata?.mimetype ?? "");

  if (
    listError ||
    !object ||
    actualSize <= 0 ||
    actualSize > MAX_PDF_BYTES ||
    actualSize !== payload.fileSize ||
    (mimeType && mimeType !== "application/pdf")
  ) {
    await removeInvalidUpload(payload.storagePath);
    return apiError(422, "INVALID_PDF", "The uploaded file did not pass validation.");
  }

  const { data: publicUrl } = supabase.storage
    .from(FLIPBOOK_BUCKET)
    .getPublicUrl(payload.storagePath);

  try {
    const signatureResponse = await fetch(publicUrl.publicUrl, {
      headers: { Range: "bytes=0-4" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const signature = Buffer.from(await signatureResponse.arrayBuffer()).subarray(0, 5).toString("ascii");
    if (!signatureResponse.ok || signature !== "%PDF-") {
      await removeInvalidUpload(payload.storagePath);
      return apiError(422, "INVALID_PDF", "The uploaded file is not a valid PDF.");
    }
  } catch {
    await removeInvalidUpload(payload.storagePath);
    return apiError(422, "PDF_CHECK_FAILED", "The PDF could not be verified. Please upload it again.");
  }

  const { error: insertError } = await supabase.from("flipbooks").insert({
    title: payload.title,
    slug: payload.slug,
    storage_path: payload.storagePath,
    file_size: actualSize,
  });

  if (insertError) {
    await removeInvalidUpload(payload.storagePath);
    if (insertError.code === "23505") {
      return apiError(409, "SLUG_TAKEN", "That title was just used. Try a more specific title.");
    }
    return apiError(500, "SAVE_FAILED", "The flipbook could not be published. Please try again.");
  }

  return NextResponse.json(
    { slug: payload.slug, url: `/${payload.slug}` },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
