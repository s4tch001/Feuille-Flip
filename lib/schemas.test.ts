import { describe, expect, it } from "vitest";

import { MAX_PDF_BYTES } from "@/lib/constants";
import { presignUploadSchema, titleSchema } from "@/lib/schemas";

const validUpload = {
  source: "pages" as const,
  title: "My 2026 Highlights",
  fileName: "highlights.pdf",
  fileSize: 1024,
  mimeType: "application/pdf" as const,
  pageCount: 2,
  pageWidth: 1600,
  pageHeight: 2263,
  pages: [
    { index: 1, fileSize: 120_000 },
    { index: 2, fileSize: 118_000 },
  ],
};

describe("upload validation", () => {
  it("accepts a valid rendered-page upload request", () => {
    expect(presignUploadSchema.safeParse(validUpload).success).toBe(true);
  });

  it("accepts an original PDF upload without rendered page assets", () => {
    expect(presignUploadSchema.safeParse({
      source: "pdf",
      title: "Sharp desktop text",
      fileName: "sharp.pdf",
      fileSize: 2048,
      mimeType: "application/pdf",
    }).success).toBe(true);
  });

  it("rejects non-PDF types and oversized files", () => {
    expect(presignUploadSchema.safeParse({ ...validUpload, mimeType: "text/html" }).success).toBe(false);
    expect(presignUploadSchema.safeParse({ ...validUpload, fileSize: MAX_PDF_BYTES + 1 }).success).toBe(false);
  });

  it("rejects empty, symbols-only, and overly long titles", () => {
    expect(titleSchema.safeParse(" ").success).toBe(false);
    expect(titleSchema.safeParse("✨!!!").success).toBe(false);
    expect(titleSchema.safeParse("a".repeat(81)).success).toBe(false);
  });
});
