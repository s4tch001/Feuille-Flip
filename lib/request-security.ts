const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 12;

type RateEntry = { count: number; resetsAt: number };

const globalRateLimit = globalThis as typeof globalThis & {
  uploadRateLimit?: Map<string, RateEntry>;
};

const rateLimit = globalRateLimit.uploadRateLimit ?? new Map<string, RateEntry>();
globalRateLimit.uploadRateLimit = rateLimit;

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-nf-client-connection-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const current = rateLimit.get(key);
  if (!current || current.resetsAt <= now) {
    rateLimit.set(key, { count: 1, resetsAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_WINDOW;
}

export function hasTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return process.env.NODE_ENV !== "production";

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

