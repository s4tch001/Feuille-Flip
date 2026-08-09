import { describe, expect, it } from "vitest";

import { MAX_UPLOAD_TICKET_LENGTH } from "@/lib/constants";
import { completeUploadSchema } from "@/lib/schemas";

describe("upload tickets", () => {
  it("accepts a ticket payload for the maximum PDF page count", () => {
    const pageStoragePrefix = "pages/123e4567-e89b-12d3-a456-426614174000";
    const payload = {
      kind: "pages",
      title: "Large PDF",
      slug: "large-pdf",
      pageStoragePrefix,
      pageCount: 300,
      pageWidth: 1600,
      pageHeight: 2263,
      pages: Array.from({ length: 300 }, (_, offset) => ({
        index: offset + 1,
        fileSize: 120_000,
        storagePath: `${pageStoragePrefix}/${String(offset + 1).padStart(4, "0")}.webp`,
      })),
      fileSize: 10_000_000,
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
    const ticket = `${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.signature`;

    expect(ticket.length).toBeGreaterThan(2048);
    expect(ticket.length).toBeLessThanOrEqual(MAX_UPLOAD_TICKET_LENGTH);
    expect(completeUploadSchema.safeParse({ ticket }).success).toBe(true);
  });
});
