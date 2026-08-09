import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { TURNSTILE_ACTION, verifyTurnstileToken } from "@/lib/turnstile";

const ORIGINAL_SECRET = process.env.TURNSTILE_SECRET_KEY;

function siteverifyResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Turnstile verification", () => {
  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (ORIGINAL_SECRET === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = ORIGINAL_SECRET;
  });

  it("accepts a matching action and hostname", async () => {
    const fetchMock = vi.fn().mockResolvedValue(siteverifyResponse({
      success: true,
      action: TURNSTILE_ACTION,
      hostname: "feuille-flip.netlify.app",
      "error-codes": [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyTurnstileToken(
      "fresh-token",
      "203.0.113.10",
      "feuille-flip.netlify.app",
    )).resolves.toEqual({
      ok: true,
      action: TURNSTILE_ACTION,
      hostname: "feuille-flip.netlify.app",
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(String(request.body)).toContain("remoteip=203.0.113.10");
  });

  it("omits an unknown proxy address because remoteip is optional", async () => {
    const fetchMock = vi.fn().mockResolvedValue(siteverifyResponse({
      success: true,
      action: TURNSTILE_ACTION,
      hostname: "localhost",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await verifyTurnstileToken("fresh-token", "unknown", "localhost");

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(String(request.body)).not.toContain("remoteip=");
  });

  it("reports a missing server secret as configuration failure", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyTurnstileToken("token", "unknown", "localhost")).resolves.toMatchObject({
      ok: false,
      kind: "configuration",
      errorCodes: ["missing-input-secret"],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves invalid-secret diagnostics without exposing credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(siteverifyResponse({
      success: false,
      "error-codes": ["invalid-input-secret"],
    })));

    await expect(verifyTurnstileToken("token", "unknown", "localhost")).resolves.toMatchObject({
      ok: false,
      kind: "configuration",
      errorCodes: ["invalid-input-secret"],
    });
  });

  it("distinguishes duplicate tokens from configuration failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(siteverifyResponse({
      success: false,
      "error-codes": ["timeout-or-duplicate"],
    })));

    await expect(verifyTurnstileToken("used-token", "unknown", "localhost")).resolves.toMatchObject({
      ok: false,
      kind: "challenge",
      errorCodes: ["timeout-or-duplicate"],
    });
  });

  it("rejects a successful token from the wrong action or hostname", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(siteverifyResponse({ success: true, action: "other", hostname: "localhost" }))
      .mockResolvedValueOnce(siteverifyResponse({ success: true, action: TURNSTILE_ACTION, hostname: "example.com" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyTurnstileToken("token-1", "unknown", "localhost")).resolves.toMatchObject({
      ok: false,
      kind: "policy",
      errorCodes: ["action-mismatch"],
    });
    await expect(verifyTurnstileToken("token-2", "unknown", "localhost")).resolves.toMatchObject({
      ok: false,
      kind: "policy",
      errorCodes: ["hostname-mismatch"],
    });
  });

  it("turns provider network failures into a retryable upstream result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(verifyTurnstileToken("token", "unknown", "localhost")).resolves.toMatchObject({
      ok: false,
      kind: "upstream",
      errorCodes: ["siteverify-unreachable"],
    });
  });
});
