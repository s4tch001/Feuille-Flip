import { z } from "zod";

import { MAX_PDF_BYTES, MAX_TITLE_LENGTH, MAX_UPLOAD_TICKET_LENGTH, MAX_WEBP_PAGE_BYTES, MAX_WEBP_PAGE_COUNT, MAX_WEBP_TOTAL_BYTES } from "@/lib/constants";
import { slugifyTitle } from "@/lib/slug";

export const titleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(MAX_TITLE_LENGTH, `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`)
  .refine((title) => slugifyTitle(title).length > 0, "Use at least one letter or number.");

const webpPageSchema = z.object({
  index: z.number().int().min(1).max(MAX_WEBP_PAGE_COUNT),
  fileSize: z.number().int().positive().max(MAX_WEBP_PAGE_BYTES),
});

export const authorizeUploadSchema = z.object({
  turnstileToken: z.string().trim().min(1).max(4096).optional(),
});

export const presignUploadSchema = z.object({
  title: titleSchema,
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().max(MAX_PDF_BYTES),
  mimeType: z.literal("application/pdf"),
  securityTicket: z.string().min(32).max(2048).optional(),
  pageCount: z.number().int().min(1).max(MAX_WEBP_PAGE_COUNT),
  pageWidth: z.number().int().positive().max(10_000),
  pageHeight: z.number().int().positive().max(10_000),
  pages: z.array(webpPageSchema).min(1).max(MAX_WEBP_PAGE_COUNT),
}).superRefine((input, context) => {
  if (input.pages.length !== input.pageCount) {
    context.addIssue({ code: "custom", message: "Every page must be rendered before upload.", path: ["pages"] });
  }

  const totalSize = input.pages.reduce((total, page) => total + page.fileSize, 0);
  if (totalSize > MAX_WEBP_TOTAL_BYTES) {
    context.addIssue({ code: "custom", message: "Rendered pages are too large. Try a smaller PDF.", path: ["pages"] });
  }

  const indexes = new Set(input.pages.map((page) => page.index));
  for (let index = 1; index <= input.pageCount; index += 1) {
    if (!indexes.has(index)) {
      context.addIssue({ code: "custom", message: "Rendered pages must be sequential.", path: ["pages"] });
      break;
    }
  }
});

export const completeUploadSchema = z.object({
  ticket: z.string().min(32).max(MAX_UPLOAD_TICKET_LENGTH),
});

export type PresignUploadInput = z.infer<typeof presignUploadSchema>;
