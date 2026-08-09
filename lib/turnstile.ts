import "server-only";

import { isIP } from "node:net";

type TurnstileResponse = {
  success?: boolean;
  "error-codes"?: string[];
  hostname?: string;
  action?: string;
};

export const TURNSTILE_ACTION = "turnstile-spin-v1";

export type TurnstileVerification =
  | { ok: true; hostname: string; action: string }
  | {
      ok: false;
      kind: "challenge" | "configuration" | "policy" | "upstream";
      errorCodes: string[];
      hostname?: string;
      action?: string;
    };

function failure(
  kind: Exclude<TurnstileVerification, { ok: true }>["kind"],
  errorCodes: string[],
  result?: TurnstileResponse,
): TurnstileVerification {
  return {
    ok: false,
    kind,
    errorCodes,
    hostname: result?.hostname,
    action: result?.action,
  };
}

export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp: string,
  expectedHostname: string,
): Promise<TurnstileVerification> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return failure("configuration", ["missing-input-secret"]);
  if (!token) return failure("challenge", ["missing-input-response"]);

  const body = new URLSearchParams({ secret, response: token });
  if (isIP(remoteIp)) body.set("remoteip", remoteIp);

  let response: Response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return failure("upstream", ["siteverify-unreachable"]);
  }

  if (!response.ok) return failure("upstream", [`siteverify-http-${response.status}`]);

  let result: TurnstileResponse;
  try {
    result = await response.json() as TurnstileResponse;
  } catch {
    return failure("upstream", ["siteverify-invalid-response"]);
  }

  if (result.success !== true) {
    const errorCodes = result["error-codes"]?.length ? result["error-codes"] : ["siteverify-rejected"];
    if (errorCodes.some((code) => code === "missing-input-secret" || code === "invalid-input-secret")) {
      return failure("configuration", errorCodes, result);
    }
    if (errorCodes.includes("internal-error")) return failure("upstream", errorCodes, result);
    return failure("challenge", errorCodes, result);
  }

  if (result.action !== TURNSTILE_ACTION) return failure("policy", ["action-mismatch"], result);
  if (result.hostname?.toLowerCase() !== expectedHostname.toLowerCase()) {
    return failure("policy", ["hostname-mismatch"], result);
  }

  return { ok: true, hostname: result.hostname, action: result.action };
}
