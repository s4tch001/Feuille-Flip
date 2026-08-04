import { describe, expect, it } from "vitest";

import { MAX_PDF_BYTES } from "@/lib/constants";
import { presignUploadSchema, titleSchema } from "@/lib/schemas";

const validUpload = {
  title: "My 2026 Highlights",
  fileName: "highlights.pdf",
  fileSize: 1024,
  mimeType: "application/pdf" as const,
};

describe("upload validation", () => {
  it("accepts a valid PDF upload request", () => {
    expect(presignUploadSchema.safeParse(validUpload).success).toBe(true);
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

