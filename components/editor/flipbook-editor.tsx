"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { Brand } from "@/components/brand";
import { TurnstileGate } from "@/components/turnstile-gate";
import { MAX_WEBP_PAGE_BYTES, MAX_WEBP_TOTAL_BYTES } from "@/lib/constants";
import {
  createEditorProject,
  emptyCanvas,
  getHdExportMultiplier,
  MAX_EDITOR_IMAGE_BYTES,
  MAX_EDITOR_IMAGE_DIMENSION,
  MAX_EDITOR_PAGES,
  MAX_PROJECT_FILE_BYTES,
  PAGE_SIZE_PRESETS,
  parseEditorProject,
  type CanvasState,
  type EditorProject,
  type PageSize,
} from "@/lib/editor/project";
import {
  loadLastEditorProject,
  requestPersistentEditorStorage,
  saveEditorProject,
} from "@/lib/editor/storage";
import { slugifyTitle } from "@/lib/slug";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type FabricNamespace = typeof import("fabric");
type EditorCanvas = import("fabric").Canvas;
type EditorObject = import("fabric").FabricObject;
type SaveState = "idle" | "saving" | "saved" | "error";
type PublishState = "idle" | "preparing" | "uploading" | "publishing" | "success";
type SelectedKind = "none" | "text" | "image" | "multi" | "group" | "object";
type ApiErrorBody = { error?: { message?: string } };
type PagePresignResponse = {
  pageUploads: Array<{ index: number; storagePath: string; storageToken: string }>;
  ticket: string;
};
type CompleteResponse = { slug: string; url: string };
type AuthorizeResponse = { securityTicket: string };

const HISTORY_LIMIT = 40;
const AUTOSAVE_DELAY = 700;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const FONT_CHOICES = [
  "Montserrat",
  "Playfair Display",
  "Bebas Neue",
  "Caveat",
  "Arial",
  "Georgia",
  "Trebuchet MS",
  "Verdana",
  "Palatino Linotype",
  "Courier New",
  "Lucida Handwriting",
  "Impact",
];
const TEMPLATE_CHOICES = [
  { id: "modern-cover", name: "Modern cover", detail: "Bold title" },
  { id: "editorial", name: "Editorial", detail: "Magazine style" },
  { id: "portfolio", name: "Portfolio", detail: "Image-led" },
  { id: "minimal", name: "Minimal", detail: "Clean story" },
];

function cloneCanvasState(value: CanvasState): CanvasState {
  return structuredClone(value);
}

function canvasStateKey(value: CanvasState): string {
  return JSON.stringify(value);
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  anchor.click();
}

function downloadTextFile(contents: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string): string {
  return value.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "flipbook";
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

async function readApiError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as ApiErrorBody;
  return body.error?.message ?? "Something went wrong. Please try again.";
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

async function renderProjectPages(
  fabric: FabricNamespace,
  project: EditorProject,
  onProgress: (page: number) => void,
): Promise<{ blobs: Blob[]; width: number; height: number }> {
  const longEdge = Math.max(project.pageSize.width, project.pageSize.height);
  const hdMultiplier = 2_560 / longEdge;
  const blobs: Blob[] = [];

  for (let index = 0; index < project.pages.length; index += 1) {
    const page = project.pages[index];
    const element = document.createElement("canvas");
    const canvas = new fabric.StaticCanvas(element, {
      width: project.pageSize.width,
      height: project.pageSize.height,
      backgroundColor: page.canvas.background ?? "#ffffff",
    });
    try {
      await canvas.loadFromJSON(page.canvas);
      canvas.backgroundColor = page.canvas.background ?? "#ffffff";
      canvas.requestRenderAll();

      let blob: Blob | null = null;
      for (const quality of [0.92, 0.86, 0.78, 0.7]) {
        const dataUrl = canvas.toDataURL({ format: "webp", quality, multiplier: hdMultiplier });
        const candidate = await dataUrlToBlob(dataUrl);
        if (candidate.size <= MAX_WEBP_PAGE_BYTES) {
          blob = candidate;
          break;
        }
      }
      if (!blob) throw new Error(`Page ${index + 1} is too detailed to publish within the 2 MB page limit.`);
      blobs.push(blob);
      onProgress(index + 1);
    } finally {
      await canvas.dispose();
    }
  }

  const totalSize = blobs.reduce((sum, blob) => sum + blob.size, 0);
  if (totalSize > MAX_WEBP_TOTAL_BYTES) {
    throw new Error("This project is over the 25 MB publishing limit. Reduce large photos or split it into two flipbooks.");
  }

  return {
    blobs,
    width: Math.round(project.pageSize.width * hdMultiplier),
    height: Math.round(project.pageSize.height * hdMultiplier),
  };
}

export function FlipbookEditor() {
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<EditorCanvas | null>(null);
  const fabricRef = useRef<FabricNamespace | null>(null);
  const projectRef = useRef<EditorProject | null>(null);
  const activePageIdRef = useRef("");
  const loadingCanvasRef = useRef(false);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<Record<string, CanvasState[]>>({});
  const futureRef = useRef<Record<string, CanvasState[]>>({});
  const imageInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [project, setProject] = useState<EditorProject | null>(null);
  const [booting, setBooting] = useState(true);
  const [canvasReady, setCanvasReady] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("My flipbook");
  const [presetId, setPresetId] = useState("a4");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [customWidth, setCustomWidth] = useState(1200);
  const [customHeight, setCustomHeight] = useState(1600);
  const [drawMode, setDrawMode] = useState(false);
  const [activeColor, setActiveColor] = useState("#17382d");
  const [activeFont, setActiveFont] = useState("Arial");
  const [fontSize, setFontSize] = useState(48);
  const [objectOpacity, setObjectOpacity] = useState(100);
  const [selectedKind, setSelectedKind] = useState<SelectedKind>("none");
  const [mobilePropertiesOpen, setMobilePropertiesOpen] = useState(false);
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [stageSize, setStageSize] = useState({ width: 900, height: 700 });
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishState, setPublishState] = useState<PublishState>("idle");
  const [publishProgress, setPublishProgress] = useState(0);
  const [publishError, setPublishError] = useState("");
  const [publishedPath, setPublishedPath] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);

  const currentPage = project?.pages.find((page) => page.id === project.activePageId) ?? null;

  const updateProject = useCallback((updater: (current: EditorProject) => EditorProject) => {
    const current = projectRef.current;
    if (!current) return;
    const next = updater(current);
    projectRef.current = next;
    activePageIdRef.current = next.activePageId;
    setProject(next);
  }, []);

  const serializeCanvas = useCallback((canvas: EditorCanvas): CanvasState => {
    const serialized = canvas.toJSON() as unknown as CanvasState;
    serialized.background = typeof canvas.backgroundColor === "string" ? canvas.backgroundColor : "#ffffff";
    return serialized;
  }, []);

  const commitCanvas = useCallback((recordHistory = true) => {
    const canvas = canvasRef.current;
    const pageId = activePageIdRef.current;
    if (!canvas || !pageId || loadingCanvasRef.current) return;

    const canvasState = serializeCanvas(canvas);
    let thumbnail: string | undefined;
    try {
      const projectValue = projectRef.current;
      const previewMultiplier = projectValue ? Math.min(0.24, 240 / projectValue.pageSize.width) : 0.2;
      thumbnail = canvas.toDataURL({ format: "webp", quality: 0.64, multiplier: previewMultiplier });
    } catch {
      thumbnail = undefined;
    }

    if (recordHistory) {
      const history = historyRef.current[pageId] ?? [];
      if (!history.length || canvasStateKey(history.at(-1)!) !== canvasStateKey(canvasState)) {
        historyRef.current[pageId] = [...history, cloneCanvasState(canvasState)].slice(-HISTORY_LIMIT);
        futureRef.current[pageId] = [];
      }
    }

    updateProject((current) => ({
      ...current,
      pages: current.pages.map((page) => page.id === pageId ? { ...page, canvas: canvasState, thumbnail } : page),
      updatedAt: new Date().toISOString(),
    }));
  }, [serializeCanvas, updateProject]);

  const queueCanvasCommit = useCallback(() => {
    if (loadingCanvasRef.current) return;
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => commitCanvas(true), 160);
  }, [commitCanvas]);

  const syncSelectionControls = useCallback(() => {
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject();
    if (!object) {
      setSelectedKind("none");
      return;
    }
    if (object.type === "activeselection") setSelectedKind("multi");
    else if (object.type === "group") setSelectedKind("group");
    else if (object.type === "image") setSelectedKind("image");
    else if (object.type?.includes("text")) setSelectedKind("text");
    else setSelectedKind("object");

    setObjectOpacity(Math.round((object.opacity ?? 1) * 100));
    const objectValues = object as EditorObject & { fontFamily?: string; fontSize?: number; fill?: string };
    if (objectValues.fontFamily && FONT_CHOICES.includes(objectValues.fontFamily)) setActiveFont(objectValues.fontFamily);
    if (objectValues.fontSize) setFontSize(Math.round(objectValues.fontSize));
    if (typeof objectValues.fill === "string" && /^#[0-9a-f]{6}$/i.test(objectValues.fill)) setActiveColor(objectValues.fill);
  }, []);

  const snapMovingObject = useCallback((event: { target?: EditorObject }) => {
    const object = event.target;
    const projectValue = projectRef.current;
    if (!object || !projectValue) return;
    const threshold = 10;
    const center = object.getCenterPoint();
    const targetsX = [0, projectValue.pageSize.width / 2, projectValue.pageSize.width];
    const targetsY = [0, projectValue.pageSize.height / 2, projectValue.pageSize.height];
    const bounds = object.getBoundingRect();
    const anchorsX = [bounds.left, center.x, bounds.left + bounds.width];
    const anchorsY = [bounds.top, center.y, bounds.top + bounds.height];
    for (const target of targetsX) {
      const anchor = anchorsX.find((value) => Math.abs(value - target) <= threshold);
      if (anchor !== undefined) object.set("left", (object.left ?? 0) + target - anchor);
    }
    for (const target of targetsY) {
      const anchor = anchorsY.find((value) => Math.abs(value - target) <= threshold);
      if (anchor !== undefined) object.set("top", (object.top ?? 0) + target - anchor);
    }
  }, []);

  const loadCanvasState = useCallback(async (canvasState: CanvasState, pageId: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    loadingCanvasRef.current = true;
    try {
      await canvas.loadFromJSON(canvasState);
      canvas.backgroundColor = canvasState.background ?? "#ffffff";
      canvas.requestRenderAll();
      setBackgroundColor(canvasState.background ?? "#ffffff");
      if (!historyRef.current[pageId]?.length) historyRef.current[pageId] = [cloneCanvasState(canvasState)];
    } finally {
      loadingCanvasRef.current = false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadLastEditorProject()
      .then((stored) => {
        if (!active || !stored) return;
        projectRef.current = stored;
        activePageIdRef.current = stored.activePageId;
        setProject(stored);
      })
      .catch(() => {
        if (active) setMessage("Your previous local draft could not be opened.");
      })
      .finally(() => {
        if (active) setBooting(false);
      });
    void requestPersistentEditorStorage().catch(() => false);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    projectRef.current = project;
    activePageIdRef.current = project?.activePageId ?? "";
  }, [project]);

  useEffect(() => {
    const projectValue = projectRef.current;
    const element = canvasElementRef.current;
    if (!projectValue || !element) return;
    let disposed = false;
    let canvas: EditorCanvas | null = null;

    void import("fabric").then((fabric) => {
      if (disposed) return;
      fabricRef.current = fabric;
      canvas = new fabric.Canvas(element, {
        width: projectValue.pageSize.width,
        height: projectValue.pageSize.height,
        backgroundColor: "#ffffff",
        preserveObjectStacking: true,
        selection: true,
      });
      canvasRef.current = canvas;
      canvas.on("object:added", queueCanvasCommit);
      canvas.on("object:modified", queueCanvasCommit);
      canvas.on("object:removed", queueCanvasCommit);
      canvas.on("path:created", queueCanvasCommit);
      canvas.on("text:changed", queueCanvasCommit);
      canvas.on("selection:created", syncSelectionControls);
      canvas.on("selection:updated", syncSelectionControls);
      canvas.on("selection:cleared", syncSelectionControls);
      canvas.on("object:moving", snapMovingObject);
      setCanvasReady((value) => value + 1);
    }).catch(() => setMessage("The editor engine could not be loaded."));

    return () => {
      disposed = true;
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      if (canvas) {
        canvas.off();
        void canvas.dispose();
      }
      if (canvasRef.current === canvas) canvasRef.current = null;
    };
  }, [project?.id, project?.pageSize.height, project?.pageSize.width, queueCanvasCommit, snapMovingObject, syncSelectionControls]);

  useEffect(() => {
    if (!canvasReady) return;
    const page = projectRef.current?.pages.find((item) => item.id === activePageIdRef.current);
    if (page) void loadCanvasState(page.canvas, page.id);
  }, [canvasReady, loadCanvasState, project?.activePageId]);

  useEffect(() => {
    if (!project || booting) return;
    const timer = setTimeout(() => {
      setSaveState("saving");
      void saveEditorProject(project)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [booting, project]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [project]);

  const pageScale = useMemo(() => {
    if (!project) return 1;
    return Math.min(
      1,
      Math.max(0.08, (stageSize.width - 16) / project.pageSize.width),
      Math.max(0.08, (stageSize.height - 16) / project.pageSize.height),
    );
  }, [project, stageSize]);

  const scaledPageStyle = useMemo(() => project ? {
    width: project.pageSize.width * pageScale,
    height: project.pageSize.height * pageScale,
  } : undefined, [pageScale, project]);

  const canvasTransformStyle = useMemo(() => project ? {
    width: project.pageSize.width,
    height: project.pageSize.height,
    transform: `scale(${pageScale})`,
    transformOrigin: "top left",
  } : undefined, [pageScale, project]);

  const chosenSize = useMemo<PageSize>(() => {
    const preset = PAGE_SIZE_PRESETS.find((item) => item.id === presetId);
    const validWidth = Number.isFinite(customWidth) ? Math.min(5_000, Math.max(240, Math.round(customWidth))) : 1_200;
    const validHeight = Number.isFinite(customHeight) ? Math.min(5_000, Math.max(240, Math.round(customHeight))) : 1_600;
    const base = preset ?? { id: "custom", name: "Custom", width: validWidth, height: validHeight };
    const wantsLandscape = orientation === "landscape";
    const width = wantsLandscape ? Math.max(base.width, base.height) : Math.min(base.width, base.height);
    const height = wantsLandscape ? Math.min(base.width, base.height) : Math.max(base.width, base.height);
    return { ...base, width, height };
  }, [customHeight, customWidth, orientation, presetId]);

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = createEditorProject(title, chosenSize);
    historyRef.current = { [next.activePageId]: [cloneCanvasState(next.pages[0].canvas)] };
    futureRef.current = {};
    projectRef.current = next;
    activePageIdRef.current = next.activePageId;
    setProject(next);
    setMessage("");
  }

  function handlePreset(event: MouseEvent<HTMLButtonElement>) {
    setPresetId(event.currentTarget.dataset.preset ?? "a4");
  }

  function handleOrientation(event: MouseEvent<HTMLButtonElement>) {
    setOrientation(event.currentTarget.dataset.orientation === "landscape" ? "landscape" : "portrait");
  }

  function handlePageSelection(event: MouseEvent<HTMLButtonElement>) {
    const pageId = event.currentTarget.dataset.page;
    if (!pageId || pageId === activePageIdRef.current) return;
    commitCanvas(true);
    updateProject((current) => ({ ...current, activePageId: pageId, updatedAt: new Date().toISOString() }));
  }

  function handleAddPage() {
    if (!project || project.pages.length >= MAX_EDITOR_PAGES) return;
    commitCanvas(true);
    const pageId = crypto.randomUUID();
    const canvas = emptyCanvas();
    historyRef.current[pageId] = [cloneCanvasState(canvas)];
    updateProject((current) => ({
      ...current,
      pages: [...current.pages, { id: pageId, name: `Page ${current.pages.length + 1}`, canvas }],
      activePageId: pageId,
      updatedAt: new Date().toISOString(),
    }));
  }

  function handleDuplicatePage() {
    if (!project || !currentPage || project.pages.length >= MAX_EDITOR_PAGES) return;
    commitCanvas(true);
    const pageId = crypto.randomUUID();
    const canvas = canvasRef.current ? serializeCanvas(canvasRef.current) : cloneCanvasState(currentPage.canvas);
    historyRef.current[pageId] = [cloneCanvasState(canvas)];
    updateProject((current) => ({
      ...current,
      pages: [...current.pages, { id: pageId, name: `Page ${current.pages.length + 1}`, canvas }],
      activePageId: pageId,
      updatedAt: new Date().toISOString(),
    }));
  }

  function handleDeletePage() {
    if (!project || project.pages.length === 1) return;
    const index = project.pages.findIndex((page) => page.id === project.activePageId);
    const remaining = project.pages.filter((page) => page.id !== project.activePageId);
    const activePageId = remaining[Math.min(index, remaining.length - 1)].id;
    updateProject((current) => ({
      ...current,
      pages: current.pages.filter((page) => page.id !== current.activePageId),
      activePageId,
      updatedAt: new Date().toISOString(),
    }));
  }

  function handleTitleChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.currentTarget.value.slice(0, 80);
    updateProject((current) => ({ ...current, title: value || "Untitled flipbook", updatedAt: new Date().toISOString() }));
  }

  function centerObject(object: EditorObject) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.centerObject(object);
    canvas.setActiveObject(object);
    canvas.requestRenderAll();
  }

  function handleAddText() {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    const projectValue = projectRef.current;
    if (!canvas || !fabric || !projectValue) return;
    const text = new fabric.Textbox("Double-click to edit", {
      width: projectValue.pageSize.width * 0.62,
      fontSize: Math.max(32, projectValue.pageSize.width * 0.055),
      fontFamily: activeFont,
      fill: activeColor,
      textAlign: "center",
    });
    canvas.add(text);
    centerObject(text);
  }

  function handleAddShape(event: MouseEvent<HTMLButtonElement>) {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    const projectValue = projectRef.current;
    if (!canvas || !fabric || !projectValue) return;
    const size = Math.min(projectValue.pageSize.width, projectValue.pageSize.height) * 0.22;
    const object = event.currentTarget.dataset.shape === "circle"
      ? new fabric.Circle({ radius: size / 2, fill: activeColor })
      : new fabric.Rect({ width: size * 1.35, height: size, rx: size * 0.08, ry: size * 0.08, fill: activeColor });
    canvas.add(object);
    centerObject(object);
  }

  function handleDrawMode() {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    const projectValue = projectRef.current;
    if (!canvas || !fabric || !projectValue) return;
    const next = !drawMode;
    canvas.isDrawingMode = next;
    if (next) {
      const brush = new fabric.PencilBrush(canvas);
      brush.color = activeColor;
      brush.width = Math.max(4, projectValue.pageSize.width / 180);
      canvas.freeDrawingBrush = brush;
    }
    setDrawMode(next);
  }

  function handleChooseImage() {
    imageInputRef.current?.click();
  }

  async function handleImageFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!IMAGE_TYPES.has(file.type) || file.size > MAX_EDITOR_IMAGE_BYTES) {
      setMessage("Choose a JPG, PNG, or WebP image up to 10 MB.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const tooLarge = bitmap.width > MAX_EDITOR_IMAGE_DIMENSION || bitmap.height > MAX_EDITOR_IMAGE_DIMENSION;
      bitmap.close();
      if (tooLarge) throw new Error("The image is larger than 8,000 pixels.");
      const dataUrl = await readAsDataUrl(file);
      const fabric = fabricRef.current;
      const canvas = canvasRef.current;
      const projectValue = projectRef.current;
      if (!fabric || !canvas || !projectValue) return;
      const image = await fabric.FabricImage.fromURL(dataUrl);
      const scale = Math.min(
        projectValue.pageSize.width * 0.72 / Math.max(1, image.width),
        projectValue.pageSize.height * 0.72 / Math.max(1, image.height),
        1,
      );
      image.scale(scale);
      canvas.add(image);
      centerObject(image);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The image could not be added.");
    }
  }

  function handleColorChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.currentTarget.value;
    setActiveColor(value);
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject();
    if (canvas?.freeDrawingBrush) canvas.freeDrawingBrush.color = value;
    if (!canvas || !object) return;
    if (object.type === "path") object.set("stroke", value);
    else object.set("fill", value);
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleFontChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.currentTarget.value;
    setActiveFont(value);
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject();
    if (!canvas || !object || !object.type?.includes("text")) return;
    object.set("fontFamily", value);
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleFontSizeChange(event: ChangeEvent<HTMLInputElement>) {
    const value = Math.min(400, Math.max(8, event.currentTarget.valueAsNumber || 8));
    setFontSize(value);
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject();
    if (!canvas || !object || !object.type?.includes("text")) return;
    object.set("fontSize", value);
    object.setCoords();
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleTextStyle(event: MouseEvent<HTMLButtonElement>) {
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject();
    if (!canvas || !object || !object.type?.includes("text")) return;
    const style = event.currentTarget.dataset.textStyle;
    const values = object as EditorObject & { fontWeight?: string | number; fontStyle?: string; underline?: boolean; textAlign?: string };
    if (style === "bold") object.set("fontWeight", values.fontWeight === "bold" ? "normal" : "bold");
    if (style === "italic") object.set("fontStyle", values.fontStyle === "italic" ? "normal" : "italic");
    if (style === "underline") object.set("underline", !values.underline);
    if (style?.startsWith("align-")) object.set("textAlign", style.replace("align-", ""));
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleTextEffect(event: MouseEvent<HTMLButtonElement>) {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    const object = canvas?.getActiveObject();
    if (!canvas || !fabric || !object || !object.type?.includes("text")) return;
    const effect = event.currentTarget.dataset.effect;
    if (effect === "shadow") {
      object.set("shadow", object.shadow ? null : new fabric.Shadow({ color: "rgba(0,0,0,0.32)", blur: 14, offsetX: 5, offsetY: 7 }));
    }
    if (effect === "outline") {
      object.set({ stroke: object.stroke ? undefined : "#ffffff", strokeWidth: object.stroke ? 0 : Math.max(1, fontSize / 24) });
    }
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleOpacityChange(event: ChangeEvent<HTMLInputElement>) {
    const value = Math.min(100, Math.max(5, event.currentTarget.valueAsNumber || 100));
    setObjectOpacity(value);
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject();
    if (!canvas || !object) return;
    object.set("opacity", value / 100);
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleAlignObject(event: MouseEvent<HTMLButtonElement>) {
    const canvas = canvasRef.current;
    const projectValue = projectRef.current;
    const object = canvas?.getActiveObject();
    if (!canvas || !projectValue || !object) return;
    const alignment = event.currentTarget.dataset.align;
    const bounds = object.getBoundingRect();
    const center = object.getCenterPoint();
    if (alignment === "left") object.set("left", (object.left ?? 0) - bounds.left);
    if (alignment === "right") object.set("left", (object.left ?? 0) + projectValue.pageSize.width - bounds.left - bounds.width);
    if (alignment === "center") object.set("left", (object.left ?? 0) + projectValue.pageSize.width / 2 - center.x);
    if (alignment === "top") object.set("top", (object.top ?? 0) - bounds.top);
    if (alignment === "bottom") object.set("top", (object.top ?? 0) + projectValue.pageSize.height - bounds.top - bounds.height);
    if (alignment === "middle") object.set("top", (object.top ?? 0) + projectValue.pageSize.height / 2 - center.y);
    object.setCoords();
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleFlipObject(event: MouseEvent<HTMLButtonElement>) {
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject();
    if (!canvas || !object) return;
    if (event.currentTarget.dataset.flip === "x") object.set("flipX", !object.flipX);
    else object.set("flipY", !object.flipY);
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleGroupSelection() {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !fabric || !active || active.type !== "activeselection") return;
    const objects = (active as import("fabric").ActiveSelection).removeAll();
    canvas.remove(...objects);
    const group = new fabric.Group(objects);
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.requestRenderAll();
    syncSelectionControls();
    queueCanvasCommit();
  }

  function handleUngroupSelection() {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !fabric || !active || active.type !== "group") return;
    const objects = (active as import("fabric").Group).removeAll();
    canvas.remove(active);
    canvas.add(...objects);
    canvas.setActiveObject(new fabric.ActiveSelection(objects, { canvas }));
    canvas.requestRenderAll();
    syncSelectionControls();
    queueCanvasCommit();
  }

  function handleImageFilter(event: MouseEvent<HTMLButtonElement>) {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !fabric || !(active instanceof fabric.FabricImage)) return;
    const filter = event.currentTarget.dataset.filter;
    if (filter === "none") active.filters = [];
    if (filter === "grayscale") active.filters = [new fabric.filters.Grayscale()];
    if (filter === "sepia") active.filters = [new fabric.filters.Sepia()];
    if (filter === "vivid") active.filters = [new fabric.filters.Saturation({ saturation: 0.34 }), new fabric.filters.Contrast({ contrast: 0.13 })];
    if (filter === "vintage") active.filters = [new fabric.filters.Vintage()];
    active.applyFilters();
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleImageMask(event: MouseEvent<HTMLButtonElement>) {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !fabric || !(active instanceof fabric.FabricImage)) return;
    const mask = event.currentTarget.dataset.mask;
    if (mask === "none") active.set("clipPath", undefined);
    if (mask === "circle") {
      active.set("clipPath", new fabric.Circle({
        radius: Math.min(active.width, active.height) / 2,
        originX: "center",
        originY: "center",
      }));
    }
    if (mask === "rounded") {
      active.set("clipPath", new fabric.Rect({
        width: active.width,
        height: active.height,
        rx: Math.min(active.width, active.height) * 0.12,
        ry: Math.min(active.width, active.height) * 0.12,
        originX: "center",
        originY: "center",
      }));
    }
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleCropSquare() {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !fabric || !(active instanceof fabric.FabricImage)) return;
    const size = Math.min(active.width, active.height);
    active.set({
      cropX: Math.max(0, (active.width - size) / 2),
      cropY: Math.max(0, (active.height - size) / 2),
      width: size,
      height: size,
    });
    active.setCoords();
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleRemoveLightBackground() {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !fabric || !(active instanceof fabric.FabricImage)) return;
    active.filters = [...active.filters.filter((filter) => filter.type !== "RemoveColor"), new fabric.filters.RemoveColor({ color: "#ffffff", distance: 0.16, useAlpha: false })];
    active.applyFilters();
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleApplyTemplate(event: MouseEvent<HTMLButtonElement>) {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    const projectValue = projectRef.current;
    if (!canvas || !fabric || !projectValue) return;
    const template = event.currentTarget.dataset.template;
    const width = projectValue.pageSize.width;
    const height = projectValue.pageSize.height;
    const titleSize = Math.max(38, width * 0.085);
    const bodySize = Math.max(20, width * 0.03);
    canvas.remove(...canvas.getObjects());

    if (template === "modern-cover") {
      canvas.backgroundColor = "#20164f";
      canvas.add(new fabric.Circle({ left: width * 0.6, top: -height * 0.08, radius: width * 0.38, fill: "#ffd96a", opacity: 0.95 }));
      canvas.add(new fabric.Textbox(projectValue.title, { left: width * 0.09, top: height * 0.42, width: width * 0.72, fontFamily: "Playfair Display", fontSize: titleSize, fontWeight: "bold", fill: "#ffffff" }));
      canvas.add(new fabric.Textbox("A story worth flipping through", { left: width * 0.1, top: height * 0.72, width: width * 0.62, fontFamily: "Arial", fontSize: bodySize, fill: "#ddd4ff" }));
    } else if (template === "editorial") {
      canvas.backgroundColor = "#f4efe5";
      canvas.add(new fabric.Rect({ left: width * 0.08, top: height * 0.08, width: width * 0.84, height: height * 0.012, fill: "#d94f45" }));
      canvas.add(new fabric.Textbox("EDITORIAL", { left: width * 0.08, top: height * 0.12, width: width * 0.42, fontFamily: "Bebas Neue", fontSize: bodySize, charSpacing: 240, fill: "#d94f45" }));
      canvas.add(new fabric.Textbox(projectValue.title, { left: width * 0.08, top: height * 0.26, width: width * 0.78, fontFamily: "Playfair Display", fontSize: titleSize, fill: "#172038" }));
      canvas.add(new fabric.Textbox("Add a strong opening paragraph here. Keep it concise, useful, and inviting.", { left: width * 0.08, top: height * 0.62, width: width * 0.6, fontFamily: "Georgia", fontSize: bodySize, lineHeight: 1.45, fill: "#5f6677" }));
    } else if (template === "portfolio") {
      canvas.backgroundColor = "#f7f6f2";
      canvas.add(new fabric.Rect({ left: width * 0.07, top: height * 0.07, width: width * 0.86, height: height * 0.58, fill: "#d9ddd8", rx: width * 0.02, ry: width * 0.02 }));
      canvas.add(new fabric.Textbox("ADD YOUR PHOTO", { left: width * 0.25, top: height * 0.33, width: width * 0.5, fontFamily: "Arial", fontSize: bodySize * 0.72, fontWeight: "bold", textAlign: "center", charSpacing: 120, fill: "#79837c" }));
      canvas.add(new fabric.Textbox(projectValue.title, { left: width * 0.07, top: height * 0.71, width: width * 0.72, fontFamily: "Montserrat", fontSize: titleSize * 0.7, fontWeight: "bold", fill: "#17382d" }));
      canvas.add(new fabric.Textbox("Selected work · 2026", { left: width * 0.07, top: height * 0.86, width: width * 0.7, fontFamily: "Arial", fontSize: bodySize, fill: "#5f6677" }));
    } else {
      canvas.backgroundColor = "#ffffff";
      canvas.add(new fabric.Textbox(projectValue.title, { left: width * 0.12, top: height * 0.2, width: width * 0.76, fontFamily: "Palatino Linotype", fontSize: titleSize, textAlign: "center", fill: "#172038" }));
      canvas.add(new fabric.Rect({ left: width * 0.42, top: height * 0.52, width: width * 0.16, height: Math.max(3, height * 0.004), fill: "#7057f5" }));
      canvas.add(new fabric.Textbox("Simple ideas, beautifully presented.", { left: width * 0.18, top: height * 0.62, width: width * 0.64, fontFamily: "Caveat", fontSize: bodySize * 1.45, textAlign: "center", fill: "#5f6677" }));
    }
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    setBackgroundColor(String(canvas.backgroundColor));
    queueCanvasCommit();
  }

  function handleBackgroundChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.currentTarget.value;
    setBackgroundColor(value);
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.backgroundColor = value;
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleDeleteObject() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const activeObjects = canvas.getActiveObjects();
    if (!activeObjects.length) return;
    canvas.discardActiveObject();
    activeObjects.forEach((object) => canvas.remove(object));
    canvas.requestRenderAll();
  }

  async function handleDuplicateObject() {
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject();
    if (!canvas || !object || object.type === "activeselection") return;
    const cloned = await object.clone();
    cloned.set({ left: (object.left ?? 0) + 24, top: (object.top ?? 0) + 24 });
    canvas.add(cloned);
    canvas.setActiveObject(cloned);
    canvas.requestRenderAll();
    syncSelectionControls();
    queueCanvasCommit();
  }

  function nudgeSelectedObject(deltaX: number, deltaY: number) {
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject();
    if (!canvas || !object) return;
    object.set({ left: (object.left ?? 0) + deltaX, top: (object.top ?? 0) + deltaY });
    object.setCoords();
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleLayerForward() {
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject();
    if (!canvas || !object) return;
    canvas.bringObjectForward(object);
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  function handleLayerBackward() {
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject();
    if (!canvas || !object) return;
    canvas.sendObjectBackwards(object);
    canvas.requestRenderAll();
    queueCanvasCommit();
  }

  async function applyHistoryState(state: CanvasState) {
    const pageId = activePageIdRef.current;
    await loadCanvasState(state, pageId);
    updateProject((current) => ({
      ...current,
      pages: current.pages.map((page) => page.id === pageId ? { ...page, canvas: cloneCanvasState(state) } : page),
      updatedAt: new Date().toISOString(),
    }));
  }

  function handleUndo() {
    commitCanvas(true);
    const pageId = activePageIdRef.current;
    const history = historyRef.current[pageId] ?? [];
    if (history.length < 2) return;
    const current = history.at(-1)!;
    const previous = history.at(-2)!;
    historyRef.current[pageId] = history.slice(0, -1);
    futureRef.current[pageId] = [...(futureRef.current[pageId] ?? []), cloneCanvasState(current)];
    void applyHistoryState(previous);
  }

  function handleRedo() {
    const pageId = activePageIdRef.current;
    const future = futureRef.current[pageId] ?? [];
    if (!future.length) return;
    const next = future.at(-1)!;
    futureRef.current[pageId] = future.slice(0, -1);
    historyRef.current[pageId] = [...(historyRef.current[pageId] ?? []), cloneCanvasState(next)];
    void applyHistoryState(next);
  }

  function handleExportPage() {
    const canvas = canvasRef.current;
    const projectValue = projectRef.current;
    if (!canvas || !projectValue) return;
    commitCanvas(true);
    const pageIndex = projectValue.pages.findIndex((page) => page.id === projectValue.activePageId) + 1;
    const dataUrl = canvas.toDataURL({
      format: "png",
      multiplier: getHdExportMultiplier(projectValue.pageSize),
      quality: 1,
    });
    downloadDataUrl(dataUrl, `${safeFileName(projectValue.title)}-page-${pageIndex}-hd.png`);
  }

  function handleExportProject() {
    const projectValue = projectRef.current;
    if (!projectValue) return;
    commitCanvas(true);
    const latest = projectRef.current ?? projectValue;
    downloadTextFile(JSON.stringify(latest), `${safeFileName(latest.title)}.feuilleflip`);
  }

  function handleChooseProject() {
    projectInputRef.current?.click();
  }

  async function handleImportProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > MAX_PROJECT_FILE_BYTES) {
      setMessage("Project files must be 50 MB or smaller.");
      return;
    }
    try {
      const imported = parseEditorProject(JSON.parse(await file.text()) as unknown);
      const next = { ...imported, id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
      projectRef.current = next;
      activePageIdRef.current = next.activePageId;
      historyRef.current = Object.fromEntries(next.pages.map((page) => [page.id, [cloneCanvasState(page.canvas)]]));
      futureRef.current = {};
      setProject(next);
      setMessage("Project imported and saved as a new local draft.");
    } catch {
      setMessage("That is not a valid Feuille Flip project file.");
    }
  }

  function handleNewProject() {
    commitCanvas(true);
    setProject(null);
    projectRef.current = null;
    activePageIdRef.current = "";
    setMessage("Your previous project remains saved on this device.");
  }

  function handleOpenPublish() {
    commitCanvas(true);
    setPublishError("");
    setPublishState("idle");
    setPublishProgress(0);
    setPublishedPath("");
    setPublishOpen(true);
  }

  function handleClosePublish() {
    if (publishState === "preparing" || publishState === "uploading" || publishState === "publishing") return;
    setPublishOpen(false);
  }

  async function handlePublish() {
    const projectValue = projectRef.current;
    const fabric = fabricRef.current;
    const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const securityToken = window.feuilleTurnstileToken ?? "";
    if (!projectValue || !fabric) return;
    if (!slugifyTitle(projectValue.title)) {
      setPublishError("Use at least one letter or number in the project title.");
      return;
    }
    if (turnstileSiteKey && !securityToken) {
      setPublishError("Complete the security check before publishing.");
      return;
    }

    try {
      setPublishError("");
      setPublishState("preparing");
      setPublishProgress(0);
      commitCanvas(true);
      const latestProject = projectRef.current ?? projectValue;
      const rendered = await renderProjectPages(fabric, latestProject, setPublishProgress);
      const totalSize = rendered.blobs.reduce((sum, blob) => sum + blob.size, 0);

      let securityTicket: string | undefined;
      if (turnstileSiteKey) {
        const authorizeResponse = await fetch("/api/uploads/authorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turnstileToken: securityToken }),
        });
        if (!authorizeResponse.ok) throw new Error(await readApiError(authorizeResponse));
        securityTicket = (await authorizeResponse.json() as AuthorizeResponse).securityTicket;
      }

      const presignResponse = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "pages",
          title: latestProject.title,
          fileName: `${safeFileName(latestProject.title)}.pdf`,
          fileSize: totalSize,
          mimeType: "application/pdf",
          pageCount: rendered.blobs.length,
          pageWidth: rendered.width,
          pageHeight: rendered.height,
          pages: rendered.blobs.map((blob, index) => ({ index: index + 1, fileSize: blob.size })),
          securityTicket,
        }),
      });
      if (!presignResponse.ok) throw new Error(await readApiError(presignResponse));
      const upload = await presignResponse.json() as PagePresignResponse;

      setPublishState("uploading");
      const supabase = getSupabaseBrowserClient();
      for (let index = 0; index < upload.pageUploads.length; index += 1) {
        const target = upload.pageUploads[index];
        const blob = rendered.blobs[target.index - 1];
        const { error: uploadError } = await supabase.storage
          .from("flipbooks")
          .uploadToSignedUrl(target.storagePath, target.storageToken, blob, {
            contentType: "image/webp",
            upsert: false,
          });
        if (uploadError) throw new Error(`Page ${target.index} could not upload: ${uploadError.message}`);
        setPublishProgress(index + 1);
      }

      setPublishState("publishing");
      const completeResponse = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: upload.ticket }),
      });
      if (!completeResponse.ok) throw new Error(await readApiError(completeResponse));
      const published = await completeResponse.json() as CompleteResponse;
      window.feuilleResetTurnstile?.();
      setPublishedPath(published.url);
      setPublishState("success");
    } catch (error) {
      window.feuilleResetTurnstile?.();
      setPublishState("idle");
      setPublishError(error instanceof Error ? error.message : "The flipbook could not be published.");
    }
  }

  const publishedUrl = typeof window === "undefined" || !publishedPath
    ? ""
    : new URL(publishedPath, window.location.origin).toString();

  async function handleCopyPublishedLink() {
    await navigator.clipboard.writeText(publishedUrl);
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1_600);
  }

  async function handleNativeShare() {
    const projectValue = projectRef.current;
    if (!projectValue) return;
    if (navigator.share) await navigator.share({ title: projectValue.title, url: publishedUrl });
    else await handleCopyPublishedLink();
  }

  const handleEditorKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
    const modifier = event.ctrlKey || event.metaKey;
    let action: (() => void) | undefined;
    if (event.key === "Delete" || event.key === "Backspace") action = handleDeleteObject;
    if (modifier && event.key.toLowerCase() === "d") action = () => { void handleDuplicateObject(); };
    if (modifier && event.key.toLowerCase() === "z" && !event.shiftKey) action = handleUndo;
    if (modifier && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))) action = handleRedo;
    if (modifier && event.key.toLowerCase() === "g") action = event.shiftKey ? handleUngroupSelection : handleGroupSelection;
    if (!modifier && event.key === "ArrowLeft") action = () => nudgeSelectedObject(event.shiftKey ? -10 : -1, 0);
    if (!modifier && event.key === "ArrowRight") action = () => nudgeSelectedObject(event.shiftKey ? 10 : 1, 0);
    if (!modifier && event.key === "ArrowUp") action = () => nudgeSelectedObject(0, event.shiftKey ? -10 : -1);
    if (!modifier && event.key === "ArrowDown") action = () => nudgeSelectedObject(0, event.shiftKey ? 10 : 1);
    if (!action) return;
    event.preventDefault();
    action();
  });

  useEffect(() => {
    window.addEventListener("keydown", handleEditorKeyDown);
    return () => window.removeEventListener("keydown", handleEditorKeyDown);
  }, []);

  if (booting) {
    return <main className="editor-loading"><Brand /><p>Opening your local workspace…</p></main>;
  }

  if (!project) {
    return (
      <main className="editor-setup-shell">
        <header className="editor-setup-header">
          <Brand />
          <Link href="/">Back to home</Link>
        </header>
        <form className="editor-setup-card" onSubmit={handleCreate}>
          <p className="eyebrow">Create &amp; Flip</p>
          <h1>Choose your page shape.</h1>
          <p>The selected ratio becomes the flipbook’s real ratio. HD export uses at least 2,560 pixels on the longest edge.</p>
          <label className="editor-field">
            <span>Project title</span>
            <input maxLength={80} onChange={(event) => setTitle(event.currentTarget.value)} value={title} />
          </label>
          <div className="editor-size-grid" aria-label="Page size presets">
            {PAGE_SIZE_PRESETS.map((size) => (
              <button
                className={presetId === size.id ? "editor-size-choice is-active" : "editor-size-choice"}
                data-preset={size.id}
                key={size.id}
                onClick={handlePreset}
                type="button"
              >
                <span className="editor-size-ratio" style={{ aspectRatio: `${size.width} / ${size.height}` }} />
                <strong>{size.name}</strong>
                <small>{size.width} × {size.height}</small>
              </button>
            ))}
            <button
              className={presetId === "custom" ? "editor-size-choice is-active" : "editor-size-choice"}
              data-preset="custom"
              onClick={handlePreset}
              type="button"
            >
              <span className="editor-size-ratio editor-size-custom">+</span>
              <strong>Custom</strong>
              <small>Your dimensions</small>
            </button>
          </div>
          {presetId === "custom" && (
            <div className="editor-custom-size">
              <label>Width <input max={5000} min={240} onChange={(event) => setCustomWidth(event.currentTarget.valueAsNumber)} type="number" value={customWidth} /></label>
              <label>Height <input max={5000} min={240} onChange={(event) => setCustomHeight(event.currentTarget.valueAsNumber)} type="number" value={customHeight} /></label>
            </div>
          )}
          <div className="editor-orientation" aria-label="Orientation">
            <button className={orientation === "portrait" ? "is-active" : ""} data-orientation="portrait" onClick={handleOrientation} type="button">Portrait</button>
            <button className={orientation === "landscape" ? "is-active" : ""} data-orientation="landscape" onClick={handleOrientation} type="button">Landscape</button>
          </div>
          <div className="editor-setup-summary">
            <span>{chosenSize.width} × {chosenSize.height}px</span>
            <span>Ratio {chosenSize.width}:{chosenSize.height}</span>
            <span>Local autosave</span>
          </div>
          {message && <p className="editor-message" role="status">{message}</p>}
          <button className="button button-primary editor-create-button" type="submit">Create project</button>
          <button className="editor-import-link" onClick={handleChooseProject} type="button">Import a .feuilleflip project</button>
          <input accept=".feuilleflip,application/json" hidden onChange={handleImportProject} ref={projectInputRef} type="file" />
        </form>
      </main>
    );
  }

  return (
    <main className="flip-editor-shell">
      <header className="flip-editor-header">
        <Brand compact />
        <input aria-label="Project title" className="flip-editor-title" maxLength={80} onChange={handleTitleChange} value={project.title} />
        <span className={`editor-save-state is-${saveState}`} role="status">
          {saveState === "saving" ? "Saving locally…" : saveState === "error" ? "Local save failed" : "Saved on this device"}
        </span>
        <div className="flip-editor-header-actions">
          <button onClick={handleExportProject} type="button">Save file</button>
          <button onClick={handleNewProject} type="button">New</button>
          <button className="editor-publish-button" onClick={handleOpenPublish} type="button">Publish</button>
        </div>
      </header>

      <div className="flip-editor-body">
        <aside className="editor-pages-panel">
          <div className="editor-panel-heading"><strong>Pages</strong><span>{project.pages.length}/{MAX_EDITOR_PAGES}</span></div>
          <div className="editor-page-list">
            {project.pages.map((page, index) => (
              <button
                className={page.id === project.activePageId ? "editor-page-card is-active" : "editor-page-card"}
                data-page={page.id}
                key={page.id}
                onClick={handlePageSelection}
                type="button"
              >
                <span className="editor-page-number">{index + 1}</span>
                <span className="editor-page-thumb" style={{ aspectRatio: `${project.pageSize.width} / ${project.pageSize.height}` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local data URLs cannot use the Next image optimizer */}
                  {page.thumbnail ? <img alt="" src={page.thumbnail} /> : <span />}
                </span>
              </button>
            ))}
          </div>
          <button className="editor-add-page" disabled={project.pages.length >= MAX_EDITOR_PAGES} onClick={handleAddPage} type="button">+ Add page</button>
          <div className="editor-page-actions">
            <button onClick={handleDuplicatePage} type="button">Duplicate</button>
            <button disabled={project.pages.length === 1} onClick={handleDeletePage} type="button">Delete</button>
          </div>
        </aside>

        <section className="editor-workspace">
          <div className="editor-toolbar" aria-label="Editor tools">
            <button onClick={handleAddText} type="button">Text</button>
            <button data-shape="rectangle" onClick={handleAddShape} type="button">Rectangle</button>
            <button data-shape="circle" onClick={handleAddShape} type="button">Circle</button>
            <button className={drawMode ? "is-active" : ""} onClick={handleDrawMode} type="button">Draw</button>
            <button onClick={handleChooseImage} type="button">Photo</button>
            <label className="editor-font-picker">
              <span className="sr-only">Text font</span>
              <select aria-label="Text font" onChange={handleFontChange} value={activeFont}>
                {FONT_CHOICES.map((font) => <option key={font} value={font}>{font}</option>)}
              </select>
            </label>
            <span className="editor-toolbar-separator" />
            <button onClick={handleUndo} type="button">Undo</button>
            <button onClick={handleRedo} type="button">Redo</button>
            <button className="editor-mobile-style-button" onClick={() => setMobilePropertiesOpen(true)} type="button">Style</button>
            <input accept="image/jpeg,image/png,image/webp" hidden onChange={handleImageFile} ref={imageInputRef} type="file" />
          </div>
          {message && <p className="editor-inline-message" role="status">{message}</p>}
          <div className="editor-stage" ref={stageRef}>
            <span aria-hidden="true" className="editor-ruler editor-ruler-horizontal" />
            <span aria-hidden="true" className="editor-ruler editor-ruler-vertical" />
            <div className="editor-scaled-page" style={scaledPageStyle}>
              <div className="editor-canvas-transform" style={canvasTransformStyle}>
                <canvas ref={canvasElementRef} />
              </div>
            </div>
          </div>
          <div className="editor-stage-status">
            <span>{project.pageSize.width} × {project.pageSize.height}px · {Math.round(pageScale * 100)}%</span>
            <span>HD export: {Math.round(project.pageSize.width * getHdExportMultiplier(project.pageSize))} × {Math.round(project.pageSize.height * getHdExportMultiplier(project.pageSize))}px</span>
          </div>
        </section>

        <aside className={mobilePropertiesOpen ? "editor-properties-panel is-mobile-open" : "editor-properties-panel"}>
          <div className="editor-panel-heading"><strong>Design &amp; style</strong><button className="editor-mobile-panel-close" onClick={() => setMobilePropertiesOpen(false)} type="button">Done</button></div>
          <div className="editor-property-group editor-template-group">
            <span>Quick layouts</span>
            <div className="editor-template-grid">
              {TEMPLATE_CHOICES.map((template) => (
                <button data-template={template.id} key={template.id} onClick={handleApplyTemplate} type="button">
                  <i className={`editor-template-preview is-${template.id}`} />
                  <strong>{template.name}</strong>
                  <small>{template.detail}</small>
                </button>
              ))}
            </div>
          </div>
          <label className="editor-color-control"><span>Object / brush</span><input onChange={handleColorChange} type="color" value={activeColor} /></label>
          <label className="editor-color-control"><span>Page background</span><input onChange={handleBackgroundChange} type="color" value={backgroundColor} /></label>
          {selectedKind === "text" && (
            <div className="editor-property-group">
              <span>Typography</span>
              <label className="editor-number-control">Font size <input max={400} min={8} onChange={handleFontSizeChange} type="number" value={fontSize} /></label>
              <div className="editor-compact-actions">
                <button data-text-style="bold" onClick={handleTextStyle} type="button"><b>B</b></button>
                <button data-text-style="italic" onClick={handleTextStyle} type="button"><i>I</i></button>
                <button data-text-style="underline" onClick={handleTextStyle} type="button"><u>U</u></button>
                <button data-text-style="align-left" onClick={handleTextStyle} type="button">Left</button>
                <button data-text-style="align-center" onClick={handleTextStyle} type="button">Center</button>
                <button data-text-style="align-right" onClick={handleTextStyle} type="button">Right</button>
              </div>
              <div className="editor-compact-actions editor-two-actions">
                <button data-effect="shadow" onClick={handleTextEffect} type="button">Shadow</button>
                <button data-effect="outline" onClick={handleTextEffect} type="button">Outline</button>
              </div>
            </div>
          )}
          {selectedKind !== "none" && (
            <div className="editor-property-group">
              <span>Position &amp; transparency</span>
              <label className="editor-range-control">Opacity <strong>{objectOpacity}%</strong><input max={100} min={5} onChange={handleOpacityChange} type="range" value={objectOpacity} /></label>
              <div className="editor-compact-actions">
                <button data-align="left" onClick={handleAlignObject} type="button">Left</button>
                <button data-align="center" onClick={handleAlignObject} type="button">Center</button>
                <button data-align="right" onClick={handleAlignObject} type="button">Right</button>
                <button data-align="top" onClick={handleAlignObject} type="button">Top</button>
                <button data-align="middle" onClick={handleAlignObject} type="button">Middle</button>
                <button data-align="bottom" onClick={handleAlignObject} type="button">Bottom</button>
              </div>
              <div className="editor-compact-actions editor-two-actions">
                <button data-flip="x" onClick={handleFlipObject} type="button">Flip horizontal</button>
                <button data-flip="y" onClick={handleFlipObject} type="button">Flip vertical</button>
              </div>
            </div>
          )}
          {selectedKind === "multi" && <button className="editor-wide-action" onClick={handleGroupSelection} type="button">Group selection</button>}
          {selectedKind === "group" && <button className="editor-wide-action" onClick={handleUngroupSelection} type="button">Ungroup selection</button>}
          {selectedKind === "image" && (
            <div className="editor-property-group">
              <span>Photo tools</span>
              <div className="editor-filter-grid">
                <button data-filter="none" onClick={handleImageFilter} type="button">Original</button>
                <button data-filter="grayscale" onClick={handleImageFilter} type="button">B&amp;W</button>
                <button data-filter="sepia" onClick={handleImageFilter} type="button">Sepia</button>
                <button data-filter="vivid" onClick={handleImageFilter} type="button">Vivid</button>
                <button data-filter="vintage" onClick={handleImageFilter} type="button">Vintage</button>
              </div>
              <div className="editor-filter-grid">
                <button data-mask="none" onClick={handleImageMask} type="button">No mask</button>
                <button data-mask="circle" onClick={handleImageMask} type="button">Circle</button>
                <button data-mask="rounded" onClick={handleImageMask} type="button">Rounded</button>
              </div>
              <button onClick={handleCropSquare} type="button">Center crop square</button>
              <button onClick={handleRemoveLightBackground} type="button">Remove light background</button>
              <small className="editor-tool-hint">Background cleanup is local and works best on solid white or near-white backgrounds.</small>
            </div>
          )}
          <div className="editor-property-group">
            <span>Selected layer</span>
            <button onClick={handleLayerForward} type="button">Bring forward</button>
            <button onClick={handleLayerBackward} type="button">Send backward</button>
            <button className="is-danger" onClick={handleDeleteObject} type="button">Delete selected</button>
          </div>
          <div className="editor-property-group">
            <span>Local files</span>
            <button onClick={handleExportPage} type="button">Export current page HD</button>
            <button onClick={handleExportProject} type="button">Save project file</button>
            <button onClick={handleChooseProject} type="button">Import project file</button>
          </div>
          <div className="editor-hd-note">
            <strong>High-definition pages</strong>
            <p>The page ratio never changes. HD export raises pixel density for desktop viewing.</p>
          </div>
          <input accept=".feuilleflip,application/json" hidden onChange={handleImportProject} ref={projectInputRef} type="file" />
        </aside>
      </div>
      {publishOpen && (
        <div className="editor-publish-backdrop" onPointerDown={(event) => {
          if (event.target === event.currentTarget) handleClosePublish();
        }}>
          <section aria-labelledby="editor-publish-title" aria-modal="true" className="editor-publish-dialog" role="dialog">
            <button aria-label="Close publish dialog" className="editor-publish-close" onClick={handleClosePublish} type="button">×</button>
            {publishState === "success" ? (
              <div className="editor-publish-success">
                <span className="editor-success-check">✓</span>
                <p className="eyebrow">Your flipbook is live</p>
                <h2 id="editor-publish-title">Ready to share.</h2>
                <p>Anyone with this public link can view the HD flipbook.</p>
                <div className="editor-published-link"><span>{publishedUrl}</span><button onClick={handleCopyPublishedLink} type="button">{linkCopied ? "Copied" : "Copy"}</button></div>
                <div className="editor-social-links" aria-label="Share to social media">
                  <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(publishedUrl)}`} rel="noreferrer" target="_blank">Facebook</a>
                  <a href={`https://x.com/intent/post?url=${encodeURIComponent(publishedUrl)}&text=${encodeURIComponent(project.title)}`} rel="noreferrer" target="_blank">X</a>
                  <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(publishedUrl)}`} rel="noreferrer" target="_blank">LinkedIn</a>
                  <a href={`https://wa.me/?text=${encodeURIComponent(`${project.title} ${publishedUrl}`)}`} rel="noreferrer" target="_blank">WhatsApp</a>
                </div>
                <a className="button button-primary" href={publishedPath}>Open flipbook</a>
                <button className="button button-secondary" onClick={handleNativeShare} type="button">Share from device</button>
              </div>
            ) : (
              <div>
                <p className="eyebrow">Publish flipbook</p>
                <h2 id="editor-publish-title">Make “{project.title}” public?</h2>
                <p className="editor-publish-copy">Your draft stays local. Only the HD page images are uploaded after you confirm.</p>
                <dl className="editor-publish-summary">
                  <div><dt>Pages</dt><dd>{project.pages.length}</dd></div>
                  <div><dt>Ratio</dt><dd>{project.pageSize.width}:{project.pageSize.height}</dd></div>
                  <div><dt>Viewer quality</dt><dd>2,560px long edge</dd></div>
                </dl>
                <TurnstileGate />
                {publishError && <p className="form-error" role="alert">{publishError}</p>}
                {publishState !== "idle" && (
                  <div className="editor-publish-progress" role="status">
                    <span style={{ width: `${Math.max(6, (publishProgress / project.pages.length) * 100)}%` }} />
                    <p>{publishState === "preparing" ? `Preparing HD page ${publishProgress} of ${project.pages.length}…` : publishState === "uploading" ? `Uploading page ${publishProgress} of ${project.pages.length}…` : "Creating your public link…"}</p>
                  </div>
                )}
                <button className="button button-primary editor-confirm-publish" disabled={publishState !== "idle"} onClick={handlePublish} type="button">Publish HD flipbook</button>
                <button className="editor-publish-cancel" disabled={publishState !== "idle"} onClick={handleClosePublish} type="button">Keep editing</button>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
