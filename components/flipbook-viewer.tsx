"use client";

import Link from "next/link";
import HTMLFlipBook from "react-pageflip-enhanced";
import { useCallback, useEffect, useRef, useState } from "react";

import { Brand } from "@/components/brand";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, MaximizeIcon, ShareIcon } from "@/components/icons";

type FlipbookViewerProps = {
  title: string;
  pdfUrl: string;
  shareUrl: string;
};

type PdfDocument = Awaited<ReturnType<(typeof import("pdfjs-dist"))["getDocument"]>>["promise"] extends Promise<infer T> ? T : never;

type PageFlipApi = {
  flipNext: (corner?: "top" | "bottom") => void;
  flipPrev: (corner?: "top" | "bottom") => void;
};

type FlipbookRef = {
  pageFlip: () => PageFlipApi | undefined;
};

type FlipEvent = {
  data: number;
};

type BookSize = {
  width: number;
  height: number;
  singlePage: boolean;
};

function calculateBookSize(container: HTMLElement, pageRatio: number): BookSize {
  const singlePage = window.matchMedia("(max-width: 767px)").matches;
  const availableWidth = Math.max(240, container.clientWidth - (singlePage ? 20 : 80));
  const availableHeight = Math.max(300, container.clientHeight - (singlePage ? 18 : 36));
  const visiblePages = singlePage ? 1 : 2;
  const width = Math.floor(Math.min(availableWidth / visiblePages, availableHeight * pageRatio));
  const height = Math.floor(width / pageRatio);

  return { width, height, singlePage };
}

export function FlipbookViewer({ title, pdfUrl, shareUrl }: FlipbookViewerProps) {
  const stageRef = useRef<HTMLElement>(null);
  const flipbookRef = useRef<FlipbookRef | null>(null);
  const pdfRef = useRef<PdfDocument | null>(null);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const renderedPages = useRef(new Set<number>());
  const renderingPages = useRef(new Map<number, number>());
  const renderGeneration = useRef(0);
  const currentPageRef = useRef(1);
  const [bookSize, setBookSize] = useState<BookSize>({ width: 320, height: 452, singlePage: true });
  const [pageRatio, setPageRatio] = useState(0.707);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState("Opening your flipbook…");
  const [error, setError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const renderPage = useCallback(async (pageNumber: number) => {
    const pdf = pdfRef.current;
    const canvas = canvasRefs.current.get(pageNumber);
    const generation = renderGeneration.current;

    if (
      !pdf ||
      !canvas ||
      pageNumber < 1 ||
      pageNumber > pdf.numPages ||
      renderedPages.current.has(pageNumber) ||
      renderingPages.current.get(pageNumber) === generation
    ) return;

    renderingPages.current.set(pageNumber, generation);
    try {
      const page = await pdf.getPage(pageNumber);
      const targetWidth = canvas.parentElement?.clientWidth || 520;
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

      if (generation !== renderGeneration.current || canvasRefs.current.get(pageNumber) !== canvas) return;
      renderedPages.current.add(pageNumber);
      canvas.dataset.rendered = "true";
    } finally {
      if (renderingPages.current.get(pageNumber) === generation) renderingPages.current.delete(pageNumber);
    }
  }, []);

  const renderNearby = useCallback((page: number) => {
    for (let number = page - 2; number <= page + 3; number += 1) void renderPage(number);
  }, [renderPage]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    const pageCanvases = canvasRefs.current;
    const renderedPageNumbers = renderedPages.current;
    const renderingPageNumbers = renderingPages.current;

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
        currentPageRef.current = 1;
        setCurrentPage(1);
        setPageRatio(firstViewport.width / firstViewport.height);
        setPageCount(pdf.numPages);
        setStatus("Preparing pages…");
      } catch {
        if (!cancelled) setError("This PDF could not be opened. It may be damaged or password-protected.");
      }
    }

    void setup();
    return () => {
      cancelled = true;
      renderGeneration.current += 1;
      renderedPageNumbers.clear();
      renderingPageNumbers.clear();
      pageCanvases.clear();
      void loadingTask?.destroy();
      pdfRef.current = null;
    };
  }, [pdfUrl]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    function resizeBook() {
      const stageElement = stageRef.current;
      if (!stageElement) return;
      const nextSize = calculateBookSize(stageElement, pageRatio);
      setBookSize((currentSize) => (
        currentSize.width === nextSize.width &&
        currentSize.height === nextSize.height &&
        currentSize.singlePage === nextSize.singlePage
          ? currentSize
          : nextSize
      ));
    }

    resizeBook();
    const resizeObserver = new ResizeObserver(resizeBook);
    resizeObserver.observe(stage);
    return () => resizeObserver.disconnect();
  }, [pageRatio]);

  useEffect(() => {
    if (!pageCount) return;
    renderGeneration.current += 1;
    renderedPages.current.clear();
    renderingPages.current.clear();

    const animationFrame = window.requestAnimationFrame(() => {
      const page = currentPageRef.current;
      void Promise.all([renderPage(page), renderPage(page + 1)]).then(() => {
        renderNearby(page);
        setStatus("");
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [bookSize, pageCount, renderNearby, renderPage]);

  useEffect(() => {
    function handleKeys(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") flipbookRef.current?.pageFlip()?.flipPrev("bottom");
      if (event.key === "ArrowRight") flipbookRef.current?.pageFlip()?.flipNext("bottom");
      if (event.key === "Escape") setShareOpen(false);
    }
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, []);

  const handleFlip = useCallback((event: FlipEvent) => {
    const page = event.data + 1;
    currentPageRef.current = page;
    setCurrentPage(page);
    renderNearby(page);
  }, [renderNearby]);

  function turn(direction: "previous" | "next") {
    const pageFlip = flipbookRef.current?.pageFlip();
    if (direction === "previous") pageFlip?.flipPrev("bottom");
    else pageFlip?.flipNext("bottom");
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
        {pageCount > 0 && (
          <HTMLFlipBook
            key={`${bookSize.width}-${bookSize.height}-${bookSize.singlePage}`}
            ref={flipbookRef}
            className="flipbook"
            width={bookSize.width}
            height={bookSize.height}
            size="fixed"
            minWidth={bookSize.width}
            maxWidth={bookSize.width}
            minHeight={bookSize.height}
            maxHeight={bookSize.height}
            startPage={Math.max(0, currentPage - 1)}
            drawShadow={true}
            flippingTime={760}
            usePortrait={false}
            singlePage={bookSize.singlePage}
            startZIndex={0}
            autoSize={true}
            maxShadowOpacity={0.35}
            showCover={false}
            mobileScrollSupport={true}
            clickEventForward={true}
            useMouseEvents={true}
            swipeDistance={30}
            showPageCorners={true}
            disableFlipByClick={false}
            renderOnlyPageLengthChange={true}
            onFlip={handleFlip}
          >
            {Array.from({ length: pageCount }, (_, index) => {
              const page = index + 1;
              return (
                <div className="pdf-page" data-density="soft" key={page}>
                  <canvas
                    ref={(canvas) => {
                      if (canvas) canvasRefs.current.set(page, canvas);
                    }}
                    data-page={page}
                    aria-label={`Page ${page}`}
                  />
                </div>
              );
            })}
          </HTMLFlipBook>
        )}
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
