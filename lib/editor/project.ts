import { z } from "zod";

export const PROJECT_SCHEMA_VERSION = 1;
export const MAX_EDITOR_PAGES = 100;
export const MAX_PROJECT_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_EDITOR_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_EDITOR_IMAGE_DIMENSION = 8_000;
export const HD_PAGE_LONG_EDGE = 2_560;

export type CanvasState = {
  version?: string;
  objects: Array<Record<string, unknown>>;
  background?: string;
  [key: string]: unknown;
};

export type EditorPage = {
  id: string;
  name: string;
  canvas: CanvasState;
  thumbnail?: string;
};

export type PageSize = {
  id: string;
  name: string;
  width: number;
  height: number;
};

export type EditorProject = {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  source: "editor";
  title: string;
  pageSize: PageSize;
  pages: EditorPage[];
  activePageId: string;
  createdAt: string;
  updatedAt: string;
};

export const PAGE_SIZE_PRESETS: PageSize[] = [
  { id: "a4", name: "A4", width: 794, height: 1123 },
  { id: "letter", name: "US Letter", width: 816, height: 1056 },
  { id: "presentation", name: "Presentation 16:9", width: 1600, height: 900 },
  { id: "square", name: "Square", width: 1080, height: 1080 },
  { id: "story", name: "Story 9:16", width: 1080, height: 1920 },
];

const canvasStateSchema = z.object({
  version: z.string().max(40).optional(),
  objects: z.array(z.record(z.string(), z.unknown())).max(2_000),
  background: z.string().max(100).optional(),
}).passthrough();

const pageSizeSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  width: z.number().int().min(240).max(5_000),
  height: z.number().int().min(240).max(5_000),
});

const editorPageSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(80),
  canvas: canvasStateSchema,
  thumbnail: z.string().max(2_000_000).optional(),
});

export const editorProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1).max(100),
  source: z.literal("editor"),
  title: z.string().trim().min(1).max(80),
  pageSize: pageSizeSchema,
  pages: z.array(editorPageSchema).min(1).max(MAX_EDITOR_PAGES),
  activePageId: z.string().min(1).max(100),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).superRefine((project, context) => {
  const ids = new Set(project.pages.map((page) => page.id));
  if (ids.size !== project.pages.length) {
    context.addIssue({ code: "custom", message: "Every page must have a unique id.", path: ["pages"] });
  }
  if (!ids.has(project.activePageId)) {
    context.addIssue({ code: "custom", message: "The active page must exist.", path: ["activePageId"] });
  }
});

export function emptyCanvas(background = "#ffffff"): CanvasState {
  return { version: "7.4.0", objects: [], background };
}

export function createEditorProject(title: string, pageSize: PageSize): EditorProject {
  const now = new Date().toISOString();
  const pageId = crypto.randomUUID();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    source: "editor",
    title: title.trim().slice(0, 80) || "Untitled flipbook",
    pageSize: { ...pageSize },
    pages: [{ id: pageId, name: "Page 1", canvas: emptyCanvas() }],
    activePageId: pageId,
    createdAt: now,
    updatedAt: now,
  };
}

export function parseEditorProject(value: unknown): EditorProject {
  return editorProjectSchema.parse(value) as EditorProject;
}

export function getHdExportMultiplier(pageSize: Pick<PageSize, "width" | "height">): number {
  return Math.max(1, HD_PAGE_LONG_EDGE / Math.max(pageSize.width, pageSize.height));
}
