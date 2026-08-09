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

  const requestId = crypto.randomUUID();
  const verification = await verifyTurnstileToken(
    parsed.data.turnstileToken,
    clientIp,
    new URL(request.url).hostname,
  );
  if (!verification.ok) {
    console.warn("Turnstile validation rejected", {
      requestId,
      kind: verification.kind,
      errorCodes: verification.errorCodes,
      hostname: verification.hostname,
      action: verification.action,
    });
    if (verification.kind === "configuration") {
      return apiError(503, "SECURITY_CONFIGURATION_ERROR", "Publishing security is temporarily misconfigured. Please try again later.");
    }
    if (verification.kind === "upstream") {
      return apiError(503, "SECURITY_SERVICE_UNAVAILABLE", "The security service is temporarily unavailable. Please try again.");
    }
    if (verification.kind === "policy") {
      return apiError(403, "SECURITY_POLICY_FAILED", "The security check was not accepted for this site.");
    }
    return apiError(403, "TURNSTILE_FAILED", "Please complete a fresh security check and try again.");
  }

  return NextResponse.json(
    { securityTicket: createUploadSecurityTicket(getSupabaseSecret()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
