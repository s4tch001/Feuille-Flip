import { z } from "zod";

import { MAX_PDF_BYTES, MAX_TITLE_LENGTH } from "@/lib/constants";
import { slugifyTitle } from "@/lib/slug";

export const titleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(MAX_TITLE_LENGTH, `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`)
  .refine((title) => slugifyTitle(title).length > 0, "Use at least one letter or number.");

export const presignUploadSchema = z.object({
  title: titleSchema,
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().max(MAX_PDF_BYTES),
  mimeType: z.literal("application/pdf"),
  turnstileToken: z.string().trim().min(1).max(4096).optional(),
});

export const completeUploadSchema = z.object({
  ticket: z.string().min(32).max(2048),
});

export type PresignUploadInput = z.infer<typeof presignUploadSchema>;
