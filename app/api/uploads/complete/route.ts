import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { FLIPBOOK_BUCKET, MAX_PDF_BYTES, MAX_WEBP_PAGE_BYTES } from "@/lib/constants";
import { getClientIp, hasTrustedOrigin, isRateLimited } from "@/lib/request-security";
import { completeUploadSchema } from "@/lib/schemas";
import { createSupabaseAdmin, getSupabaseSecret } from "@/lib/supabase/server";
import { verifyUploadTicket } from "@/lib/upload-ticket";

export const runtime = "nodejs";

async function removeInvalidUpload(storagePaths: string[]) {
  try {
    await createSupabaseAdmin().storage.from(FLIPBOOK_BUCKET).remove(storagePaths);
  } catch {
    // A failed cleanup is intentionally hidden from the external response.
  }
}

async function hasPdfSignature(storagePath: string): Promise<boolean> {
  const supabase = createSupabaseAdmin();
  const publicUrl = supabase.storage.from(FLIPBOOK_BUCKET).getPublicUrl(storagePath).data.publicUrl;
  const response = await fetch(publicUrl, {
    cache: "no-store",
    headers: { Range: "bytes=0-4" },
  });
  if (!response.ok || !response.body) return false;

  const reader = response.body.getReader();
  const signature = new Uint8Array(5);
  let offset = 0;
  try {
    while (offset < signature.length) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const amount = Math.min(value.length, signature.length - offset);
      signature.set(value.subarray(0, amount), offset);
      offset += amount;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return offset === signature.length && new TextDecoder().decode(signature) === "%PDF-";
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
  if (!payload) {
    return apiError(400, "INVALID_TICKET", "The upload expired or is invalid. Please start again.");
  }

  const supabase = createSupabaseAdmin();

  if (payload.kind === "pdf") {
    if (!/^uploads\/[0-9a-f-]{36}\.pdf$/.test(payload.storagePath)) {
      return apiError(400, "INVALID_TICKET", "The upload expired or is invalid. Please start again.");
    }

    const fileName = payload.storagePath.split("/").at(-1)!;
    const { data: objects, error: listError } = await supabase.storage
      .from(FLIPBOOK_BUCKET)
      .list("uploads", { limit: 2, search: fileName });
    const uploadedPdf = objects?.find((item) => item.name === fileName);
    const actualSize = Number(uploadedPdf?.metadata?.size ?? 0);
    const mimeType = String(uploadedPdf?.metadata?.mimetype ?? "");
    const metadataIsValid = !listError && uploadedPdf && actualSize === payload.fileSize && actualSize > 0 && actualSize <= MAX_PDF_BYTES && (!mimeType || mimeType === "application/pdf");
    const signatureIsValid = metadataIsValid
      ? await hasPdfSignature(payload.storagePath).catch(() => false)
      : false;

    if (!metadataIsValid || !signatureIsValid) {
      await removeInvalidUpload([payload.storagePath]);
      return apiError(422, "INVALID_PDF", "The PDF did not pass validation.");
    }

    const { error: insertError } = await supabase.from("flipbooks").insert({
      title: payload.title,
      slug: payload.slug,
      storage_path: payload.storagePath,
      file_size: actualSize,
    });

    if (insertError) {
      await removeInvalidUpload([payload.storagePath]);
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

  if (
    !/^pages\/[0-9a-f-]{36}$/.test(payload.pageStoragePrefix) ||
    payload.pages.length !== payload.pageCount ||
    payload.pages.some((page) => !/^pages\/[0-9a-f-]{36}\/\d{4}\.webp$/.test(page.storagePath))
  ) {
    return apiError(400, "INVALID_TICKET", "The upload expired or is invalid. Please start again.");
  }

  const pageFileNames = new Map(payload.pages.map((page) => [page.storagePath.split("/").at(-1)!, page]));
  const { data: objects, error: listError } = await supabase.storage
    .from(FLIPBOOK_BUCKET)
    .list(payload.pageStoragePrefix, { limit: payload.pageCount + 1 });
  const uploadedPages = objects?.filter((item) => pageFileNames.has(item.name)) ?? [];

  if (listError || uploadedPages.length !== payload.pageCount) {
    await removeInvalidUpload(payload.pages.map((page) => page.storagePath));
    return apiError(422, "INVALID_PAGES", "The rendered pages did not pass validation.");
  }

  for (const object of uploadedPages) {
    const page = pageFileNames.get(object.name);
    const actualSize = Number(object.metadata?.size ?? 0);
    const mimeType = String(object.metadata?.mimetype ?? "");
    if (!page || actualSize <= 0 || actualSize > MAX_WEBP_PAGE_BYTES || actualSize !== page.fileSize || (mimeType && mimeType !== "image/webp")) {
      await removeInvalidUpload(payload.pages.map((item) => item.storagePath));
      return apiError(422, "INVALID_PAGES", "The rendered pages did not pass validation.");
    }
  }
  const actualSize = uploadedPages.reduce((total, object) => total + Number(object.metadata?.size ?? 0), 0);

  const { error: insertError } = await supabase.from("flipbooks").insert({
    title: payload.title,
    slug: payload.slug,
    storage_path: null,
    page_storage_prefix: payload.pageStoragePrefix,
    page_count: payload.pageCount,
    page_width: payload.pageWidth,
    page_height: payload.pageHeight,
    page_paths: payload.pages.sort((a, b) => a.index - b.index).map((page) => page.storagePath),
    file_size: actualSize,
  });

  if (insertError) {
    await removeInvalidUpload(payload.pages.map((page) => page.storagePath));
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
