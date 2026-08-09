import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { FLIPBOOK_BUCKET } from "@/lib/constants";
import { getClientIp, hasTrustedOrigin, isRateLimited } from "@/lib/request-security";
import { presignUploadSchema } from "@/lib/schemas";
import { slugifyTitle } from "@/lib/slug";
import { createSupabaseAdmin, getSupabaseSecret } from "@/lib/supabase/server";
import { verifyUploadSecurityTicket } from "@/lib/upload-security-ticket";
import { createUploadTicket } from "@/lib/upload-ticket";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return apiError(403, "UNTRUSTED_ORIGIN", "This upload request was not accepted.");
  }
  const clientIp = getClientIp(request);
  if (isRateLimited(`presign:${clientIp}`)) {
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

  let secret: string;
  try {
    secret = getSupabaseSecret();
  } catch {
    return apiError(500, "UPLOAD_SETUP_FAILED", "Upload could not be started. Please try again.");
  }

  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !verifyUploadSecurityTicket(parsed.data.securityTicket, secret)) {
    return apiError(403, "SECURITY_CHECK_EXPIRED", "The security check expired. Please complete it again before uploading.");
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

    if (parsed.data.source === "pdf") {
      const storagePath = `uploads/${randomUUID()}.pdf`;
      const { data: signedUpload, error: uploadError } = await supabase.storage
        .from(FLIPBOOK_BUCKET)
        .createSignedUploadUrl(storagePath, { upsert: false });

      if (uploadError || !signedUpload) throw uploadError ?? new Error("No upload token returned.");

      const ticket = createUploadTicket(
        {
          kind: "pdf",
          title: parsed.data.title,
          slug,
          storagePath,
          fileSize: parsed.data.fileSize,
        },
        secret,
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
    }

    const pageStoragePrefix = `pages/${randomUUID()}`;
    const pageUploads = await Promise.all(parsed.data.pages.map(async (page) => {
      const storagePath = `${pageStoragePrefix}/${String(page.index).padStart(4, "0")}.webp`;
      const { data: signedUpload, error: uploadError } = await supabase.storage
        .from(FLIPBOOK_BUCKET)
        .createSignedUploadUrl(storagePath, { upsert: false });

      if (uploadError || !signedUpload) throw uploadError ?? new Error("No upload token returned.");
      return { index: page.index, storagePath, storageToken: signedUpload.token, fileSize: page.fileSize };
    }));

    const ticket = createUploadTicket(
      {
        kind: "pages",
        title: parsed.data.title,
        slug,
        pageStoragePrefix,
        pageCount: parsed.data.pageCount,
        pageWidth: parsed.data.pageWidth,
        pageHeight: parsed.data.pageHeight,
        pages: pageUploads.map(({ index, storagePath, fileSize }) => ({ index, storagePath, fileSize })),
        fileSize: parsed.data.fileSize,
      },
      secret,
    );

    return NextResponse.json(
      {
        slug,
        pageStoragePrefix,
        pageUploads: pageUploads.map(({ index, storagePath, storageToken }) => ({ index, storagePath, storageToken })),
        ticket,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return apiError(500, "UPLOAD_SETUP_FAILED", "Upload could not be started. Please try again.");
  }
}
