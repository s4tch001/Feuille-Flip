import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { getClientIp, hasTrustedOrigin, isRateLimited } from "@/lib/request-security";
import { authorizeUploadSchema } from "@/lib/schemas";
import { getSupabaseSecret } from "@/lib/supabase/server";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { createUploadSecurityTicket } from "@/lib/upload-security-ticket";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return apiError(403, "UNTRUSTED_ORIGIN", "This upload request was not accepted.");
  }
  const clientIp = getClientIp(request);
  if (isRateLimited(`authorize:${clientIp}`)) {
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

  const parsed = authorizeUploadSchema.safeParse(input);
  if (!parsed.success) {
    return apiError(422, "INVALID_SECURITY_CHECK", "The security check was not accepted.");
  }

  if (!(await verifyTurnstileToken(parsed.data.turnstileToken, clientIp))) {
    return apiError(403, "TURNSTILE_FAILED", "Please complete the security check and try again.");
  }

  return NextResponse.json(
    { securityTicket: createUploadSecurityTicket(getSupabaseSecret()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
