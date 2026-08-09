import { describe, expect, it } from "vitest";

import { createEditorProject, getHdExportMultiplier, PAGE_SIZE_PRESETS, parseEditorProject } from "@/lib/editor/project";

describe("editor projects", () => {
  it("creates a valid one-page project with the selected aspect ratio", () => {
    const project = createEditorProject("My story", PAGE_SIZE_PRESETS[0]);

    expect(parseEditorProject(project)).toEqual(project);
    expect(project.pageSize.width / project.pageSize.height).toBeCloseTo(794 / 1123);
  });

  it("rejects a project whose active page does not exist", () => {
    const project = createEditorProject("Broken", PAGE_SIZE_PRESETS[1]);
    expect(() => parseEditorProject({ ...project, activePageId: "missing" })).toThrow();
  });

  it("exports smaller logical canvases at an HD long edge", () => {
    expect(Math.round(1123 * getHdExportMultiplier(PAGE_SIZE_PRESETS[0]))).toBe(2560);
    expect(Math.round(1600 * getHdExportMultiplier(PAGE_SIZE_PRESETS[2]))).toBe(2560);
    expect(Math.round(900 * getHdExportMultiplier(PAGE_SIZE_PRESETS[2]))).toBe(1440);
    expect(getHdExportMultiplier({ width: 3000, height: 2000 })).toBe(1);
  });

  it("accepts a validated custom page ratio", () => {
    const project = createEditorProject("Custom story", { id: "custom", name: "Custom", width: 1234, height: 987 });
    expect(parseEditorProject(project).pageSize).toMatchObject({ width: 1234, height: 987 });
  });

  it("rejects duplicate page identifiers", () => {
    const project = createEditorProject("Duplicate pages", PAGE_SIZE_PRESETS[3]);
    expect(() => parseEditorProject({ ...project, pages: [project.pages[0], project.pages[0]] })).toThrow();
  });
});
