import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { UPLOAD_TICKET_TTL_MS } from "@/lib/constants";

type CommonUploadTicketPayload = {
  title: string;
  slug: string;
  fileSize: number;
  expiresAt: number;
};

export type PdfUploadTicketPayload = CommonUploadTicketPayload & {
  kind: "pdf";
  storagePath: string;
};

export type PageUploadTicketPayload = CommonUploadTicketPayload & {
  kind: "pages";
  pageStoragePrefix: string;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  pages: Array<{ index: number; fileSize: number; storagePath: string }>;
};

export type UploadTicketPayload = PdfUploadTicketPayload | PageUploadTicketPayload;
type UploadTicketInput = UploadTicketPayload extends infer Payload
  ? Payload extends UploadTicketPayload
    ? Omit<Payload, "expiresAt">
    : never
  : never;

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createUploadTicket(
  payload: UploadTicketInput,
  secret: string,
): string {
  const fullPayload: UploadTicketPayload = {
    ...payload,
    expiresAt: Date.now() + UPLOAD_TICKET_TTL_MS,
  };
  const encodedPayload = encode(JSON.stringify(fullPayload));
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifyUploadTicket(ticket: string, secret: string): UploadTicketPayload | null {
  const [encodedPayload, providedSignature, extra] = ticket.split(".");
  if (!encodedPayload || !providedSignature || extra) return null;

  const expectedSignature = sign(encodedPayload, secret);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as UploadTicketPayload;
    if (
      typeof payload.title !== "string" ||
      typeof payload.slug !== "string" ||
      typeof payload.fileSize !== "number" ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt < Date.now()
    ) {
      return null;
    }

    if (payload.kind === "pdf") {
      return typeof payload.storagePath === "string" ? payload : null;
    }

    if (
      payload.kind !== "pages" ||
      typeof payload.pageStoragePrefix !== "string" ||
      typeof payload.pageCount !== "number" ||
      typeof payload.pageWidth !== "number" ||
      typeof payload.pageHeight !== "number" ||
      !Array.isArray(payload.pages)
    ) return null;

    return payload;
  } catch {
    return null;
  }
}
