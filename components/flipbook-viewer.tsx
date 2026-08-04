"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Brand } from "@/components/brand";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, MaximizeIcon, ShareIcon } from "@/components/icons";

type FlipbookViewerProps = {
  title: string;
  pdfUrl: string;
  shareUrl: string;
};

type PdfDocument = Awaited<ReturnType<(typeof import("pdfjs-dist"))["getDocument"]>>["promise"] extends Promise<infer T> ? T : never;

let turnScriptPromise: Promise<void> | undefined;

function isTurnJsLoaded(): boolean {
  const runtimeWindow = window as unknown as { jQuery?: { fn?: { turn?: unknown } } };
  return typeof runtimeWindow.jQuery?.fn?.turn === "function";
}

async function loadTurnJs(): Promise<void> {
  if (typeof window === "undefined") return;
  if (isTurnJsLoaded()) return;
  if (turnScriptPromise) return turnScriptPromise;

  turnScriptPromise = import("jquery").then((jqueryModule) => {
    const jquery = jqueryModule.default;
    window.jQuery = jquery;
    window.$ = jquery;

    return new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/vendor/turn.min.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Turn.js could not be loaded."));
      document.head.appendChild(script);
    });
  });

  return turnScriptPromise;
}

function calculateBookSize(container: HTMLElement, pageRatio: number) {
  const single = window.matchMedia("(max-width: 767px)").matches;
  const availableWidth = Math.max(260, container.clientWidth - (single ? 20 : 80));
  const availableHeight = Math.max(320, container.clientHeight - (single ? 18 : 36));
  const pageCount = single ? 1 : 2;
  const widthFromHeight = availableHeight * pageRatio * pageCount;
  const width = Math.floor(Math.min(availableWidth, widthFromHeight));
  const height = Math.floor(width / pageCount / pageRatio);
  return { width, height, display: single ? "single" : "double" };
}

export function FlipbookViewer({ title, pdfUrl, shareUrl }: FlipbookViewerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PdfDocument | null>(null);
  const initializedTurnRef = useRef(false);
  const renderedPages = useRef(new Set<number>());
  const renderingPages = useRef(new Set<number>());
  const pageRatioRef = useRef(0.707);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState("Opening your flipbook…");
  const [error, setError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const renderPage = useCallback(async (pageNumber: number) => {
    const pdf = pdfRef.current;
    const book = bookRef.current;
    if (!pdf || !book || pageNumber < 1 || pageNumber > pdf.numPages || renderedPages.current.has(pageNumber) || renderingPages.current.has(pageNumber)) return;

    renderingPages.current.add(pageNumber);
    try {
      const page = await pdf.getPage(pageNumber);
      const canvas = book.querySelector<HTMLCanvasElement>(`canvas[data-page="${pageNumber}"]`);
      if (!canvas) return;
      const pageElement = canvas.parentElement;
      const targetWidth = pageElement?.clientWidth || 520;
      const baseViewport = page.getViewport({ scale: 1 });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (targetWidth * pixelRatio) / baseViewport.width });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      renderedPages.current.add(pageNumber);
      canvas.dataset.rendered = "true";
    } finally {
      renderingPages.current.delete(pageNumber);
    }
  }, []);

  const renderNearby = useCallback((page: number) => {
    for (let number = page - 2; number <= page + 3; number += 1) void renderPage(number);
  }, [renderPage]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;

    async function setup() {
      try {
        setError("");
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        loadingTask = pdfjs.getDocument({ url: pdfUrl });
        loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
          if (total > 0) setStatus(`Loading PDF · ${Math.round((loaded / total) * 100)}%`);
        };
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        const firstPage = await pdf.getPage(1);
        const firstViewport = firstPage.getViewport({ scale: 1 });
        pageRatioRef.current = firstViewport.width / firstViewport.height;
        setPageCount(pdf.numPages);
        setStatus("Preparing pages…");
      } catch {
        if (!cancelled) setError("This PDF could not be opened. It may be damaged or password-protected.");
      }
    }

    void setup();
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
      pdfRef.current = null;
    };
  }, [pdfUrl]);

  useEffect(() => {
    if (!pageCount || !bookRef.current || !stageRef.current) return;
    const bookElement = bookRef.current;
    const stageElement = stageRef.current;
    let destroyed = false;

    bookElement.replaceChildren();
    for (let page = 1; page <= pageCount; page += 1) {
      const pageElement = document.createElement("div");
      pageElement.className = "pdf-page";
      const canvas = document.createElement("canvas");
      canvas.dataset.page = String(page);
      canvas.setAttribute("aria-label", `Page ${page}`);
      pageElement.appendChild(canvas);
      bookElement.appendChild(pageElement);
    }

    async function initialize() {
      try {
        await Promise.all([loadTurnJs(), renderPage(1), renderPage(2)]);
        if (destroyed) return;
        const size = calculateBookSize(stageElement, pageRatioRef.current);
        const book = window.jQuery(bookElement);
        book.turn({
          width: size.width,
          height: size.height,
          display: size.display,
          autoCenter: true,
          acceleration: true,
          gradients: true,
          duration: 760,
        });
        initializedTurnRef.current = true;
        book.on("turning", (_event, page: number) => renderNearby(page));
        book.on("turned", (_event, page: number) => {
          setCurrentPage(page);
          renderNearby(page);
        });
        renderNearby(1);
        setStatus("");
      } catch {
        setError("The page-turning viewer could not be started.");
      }
    }

    function resizeBook() {
      if (!isTurnJsLoaded() || !initializedTurnRef.current) return;
      const size = calculateBookSize(stageElement, pageRatioRef.current);
      window.jQuery(bookElement).turn("display", size.display);
      window.jQuery(bookElement).turn("size", size.width, size.height);
    }

    void initialize();
    const resizeObserver = new ResizeObserver(resizeBook);
    resizeObserver.observe(stageElement);

    return () => {
      destroyed = true;
      resizeObserver.disconnect();
      const book = window.jQuery?.(bookElement);
      if (book && initializedTurnRef.current) {
        book.off("turning turned");
        book.turn("destroy");
        initializedTurnRef.current = false;
      }
    };
  }, [pageCount, renderNearby, renderPage]);

  useEffect(() => {
    function handleKeys(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") window.jQuery?.(bookRef.current!).turn("previous");
      if (event.key === "ArrowRight") window.jQuery?.(bookRef.current!).turn("next");
      if (event.key === "Escape") setShareOpen(false);
    }
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, []);

  function turn(direction: "previous" | "next") {
    if (bookRef.current && isTurnJsLoaded()) window.jQuery(bookRef.current).turn(direction);
  }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  }

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function quickShare() {
    if (navigator.share) await navigator.share({ title, text: `Flip through ${title}`, url: shareUrl });
    else setShareOpen((open) => !open);
  }

  return (
    <main className="reader-shell">
      <header className="reader-header">
        <Brand compact />
        <Link href="/" className="reader-title" title={title}>{title}</Link>
        <div className="reader-actions">
          <a className="reader-action" href={pdfUrl} download aria-label="Download PDF"><DownloadIcon /><span>Download</span></a>
          <button className="reader-action" type="button" onClick={quickShare} aria-expanded={shareOpen}><ShareIcon /><span>Share</span></button>
          <button className="reader-action fullscreen-button" type="button" onClick={toggleFullscreen} aria-label="Toggle full screen"><MaximizeIcon /><span>Full screen</span></button>
        </div>
        {shareOpen && (
          <div className="reader-share-card">
            <strong>Share this flipbook</strong>
            <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer">Facebook</a>
            <a href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(title)}`} target="_blank" rel="noreferrer">X / Twitter</a>
            <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer">LinkedIn</a>
            <button type="button" onClick={copyLink}>{copied ? "Link copied" : "Copy link"}</button>
          </div>
        )}
      </header>

      <section className="reader-stage" ref={stageRef} aria-label={`${title} flipbook viewer`}>
        {(status || error) && <div className={`reader-status ${error ? "reader-error" : ""}`} role="status"><span className="loader" />{error || status}</div>}
        <button className="page-arrow page-arrow-left" type="button" onClick={() => turn("previous")} disabled={currentPage <= 1} aria-label="Previous page"><ChevronLeftIcon /></button>
        <div className="flipbook" ref={bookRef} />
        <button className="page-arrow page-arrow-right" type="button" onClick={() => turn("next")} disabled={currentPage >= pageCount} aria-label="Next page"><ChevronRightIcon /></button>
      </section>

      <footer className="reader-controls">
        <button type="button" onClick={() => turn("previous")} disabled={currentPage <= 1}><ChevronLeftIcon /> <span>Previous</span></button>
        <p><strong>{Math.min(currentPage, pageCount || 1)}</strong><span> / {pageCount || "—"}</span></p>
        <button type="button" onClick={() => turn("next")} disabled={currentPage >= pageCount}><span>Next</span> <ChevronRightIcon /></button>
      </footer>
    </main>
  );
}
