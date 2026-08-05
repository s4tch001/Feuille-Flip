import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { UPLOAD_SECURITY_TICKET_TTL_MS } from "@/lib/constants";

type UploadSecurityTicketPayload = {
  id: string;
  expiresAt: number;
};

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createUploadSecurityTicket(secret: string): string {
  const payload: UploadSecurityTicketPayload = {
    id: randomUUID(),
    expiresAt: Date.now() + UPLOAD_SECURITY_TICKET_TTL_MS,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifyUploadSecurityTicket(ticket: string | undefined, secret: string): boolean {
  if (!ticket) return false;
  const [encodedPayload, providedSignature, extra] = ticket.split(".");
  if (!encodedPayload || !providedSignature || extra) return false;

  const expectedSignature = sign(encodedPayload, secret);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as UploadSecurityTicketPayload;
    return typeof payload.id === "string" && typeof payload.expiresAt === "number" && payload.expiresAt >= Date.now();
  } catch {
    return false;
  }
}
