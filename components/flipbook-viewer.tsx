"use client";

import Link from "next/link";
import HTMLFlipBook from "react-pageflip-enhanced";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Brand } from "@/components/brand";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, MaximizeIcon, ShareIcon } from "@/components/icons";
import {
  createViewerPageOrder,
  getViewerBookPose,
  resolveViewerInitPageIndex,
} from "@/lib/viewer-page-order";

type FlipbookViewerProps = {
  title: string;
  pdfUrl?: string;
  pageUrls?: string[];
  pageWidth?: number;
  pageHeight?: number;
  shareUrl: string;
};

type PdfDocument = Awaited<ReturnType<(typeof import("pdfjs-dist"))["getDocument"]>>["promise"] extends Promise<infer T> ? T : never;

type PageFlipApi = {
  flipNext: (corner?: "top" | "bottom") => void;
  flipPrev: (corner?: "top" | "bottom") => void;
  getPageCollection: () => {
    getCurrentSpreadIndex: () => number;
    getSpread: () => number[][];
  };
};

type FlipbookRef = {
  pageFlip: () => PageFlipApi | undefined;
};

type FlipEvent = {
  data: number;
};

type FlipInitEvent = {
  data: {
    page: number;
    mode: string;
  };
};

type BookSize = {
  width: number;
  height: number;
  singlePage: boolean;
};

type BookPage = {
  key: string;
  pdfPage: number | null;
  imageUrl?: string;
};

function calculateBookSize(container: HTMLElement, pageRatio: number): BookSize {
  const singlePage = window.matchMedia("(max-width: 1023px)").matches;
  const availableWidth = Math.max(240, container.clientWidth - (singlePage ? 20 : 80));
  const availableHeight = Math.max(300, container.clientHeight - (singlePage ? 18 : 36));
  const visiblePages = singlePage ? 1 : 2;
  const width = Math.floor(Math.min(availableWidth / visiblePages, availableHeight * pageRatio));
  const height = Math.floor(width / pageRatio);

  return { width, height, singlePage };
}

export function FlipbookViewer({ title, pdfUrl, pageUrls, pageWidth, pageHeight, shareUrl }: FlipbookViewerProps) {
  const stageRef = useRef<HTMLElement>(null);
  const flipbookRef = useRef<FlipbookRef | null>(null);
  const pdfRef = useRef<PdfDocument | null>(null);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const renderedPages = useRef(new Set<number>());
  const renderingPages = useRef(new Map<number, number>());
  const renderGeneration = useRef(0);
  const currentPageRef = useRef(1);
  const currentBookPageRef = useRef(0);
  const [bookSize, setBookSize] = useState<BookSize | null>(null);
  const [pageRatio, setPageRatio] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentBookPage, setCurrentBookPage] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState("Opening your flipbook…");
  const [error, setError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const bookPages = useMemo<BookPage[]>(() => createViewerPageOrder(
    pageCount,
    bookSize?.singlePage ? "single" : "spread",
  ).map((pdfPage) => (
    pdfPage === null
      ? { key: "blank-white-page", pdfPage: null }
      : {
        key: `${pageUrls?.length ? "webp" : "pdf"}-${pdfPage}`,
        pdfPage,
        imageUrl: pageUrls?.[pdfPage - 1],
      }
  )), [bookSize?.singlePage, pageCount, pageUrls]);

  const mappedBookPage = bookPages.findIndex((bookPage) => bookPage.pdfPage === currentPage);
  const activeBookPage = mappedBookPage >= 0
    ? mappedBookPage
    : Math.max(0, Math.min(currentBookPage, bookPages.length - 1));
  const bookPose = getViewerBookPose(activeBookPage, bookPages.length);

  const pageElements = useMemo(() => bookPages.map((bookPage) => (
    <div
      className={`pdf-page${bookPage.pdfPage === null ? " pdf-page-blank" : ""}`}
      data-density={bookPage.pdfPage === 1 || bookPage.pdfPage === pageCount ? "hard" : "soft"}
      key={bookPage.key}
      aria-label={bookPage.pdfPage === null ? "Blank page" : undefined}
    >
      <div className="pdf-page-front">
        {bookPage.pdfPage !== null && (
          bookPage.imageUrl ? (
            // The pages are already pre-rendered and compressed WebP assets.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bookPage.imageUrl}
              alt={`Page ${bookPage.pdfPage}`}
              data-page={bookPage.pdfPage}
              data-rendered="true"
              draggable={false}
            />
          ) : (
            <canvas
              ref={(canvas) => {
                if (canvas) canvasRefs.current.set(bookPage.pdfPage!, canvas);
              }}
              data-page={bookPage.pdfPage}
              aria-label={`Page ${bookPage.pdfPage}`}
            />
          )
        )}
      </div>
      <div className="pdf-page-back" aria-hidden="true" />
    </div>
  )), [bookPages, pageCount]);

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
      const minimumDesktopScale = targetWidth >= 700 ? 2.25 : 2;
      const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, minimumDesktopScale), 3);
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
        setPageCount(0);
        setBookSize(null);
        if (pageUrls?.length && pageWidth && pageHeight) {
          currentPageRef.current = 1;
          currentBookPageRef.current = 0;
          setCurrentPage(1);
          setCurrentBookPage(0);
          setPageRatio(pageWidth / pageHeight);
          setPageCount(pageUrls.length);
          setStatus("");
          return;
        }
        if (!pdfUrl) throw new Error("Missing PDF fallback.");
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
        currentBookPageRef.current = 0;
        setCurrentPage(1);
        setCurrentBookPage(0);
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
  }, [pdfUrl, pageHeight, pageUrls, pageWidth]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || pageRatio === null) return;
    const ratio = pageRatio;

    function resizeBook() {
      const stageElement = stageRef.current;
      if (!stageElement) return;
      const nextSize = calculateBookSize(stageElement, ratio);
      setBookSize((currentSize) => (
        currentSize &&
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
    if (!bookSize || !pageCount) return;
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
      const pageFlip = flipbookRef.current?.pageFlip();
      if (event.key === "ArrowLeft") pageFlip?.flipPrev("bottom");
      if (event.key === "ArrowRight") pageFlip?.flipNext("bottom");
      if (event.key === "Escape") setShareOpen(false);
    }
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, []);

  const handleFlip = useCallback((event: FlipEvent) => {
    const bookPage = Math.max(0, Math.min(bookPages.length - 1, Math.trunc(event.data)));
    const page = bookPages[bookPage]?.pdfPage ?? currentPageRef.current;
    currentBookPageRef.current = bookPage;
    currentPageRef.current = page;
    setCurrentBookPage(bookPage);
    setCurrentPage(page);
    renderNearby(page);
  }, [bookPages, renderNearby, setCurrentBookPage, setCurrentPage]);

  const handleInit = useCallback((event: FlipInitEvent) => {
    const pageFlip = flipbookRef.current?.pageFlip();
    if (!pageFlip) return;
    const collection = pageFlip.getPageCollection();
    const spread = collection.getSpread()[collection.getCurrentSpreadIndex()];
    const bookPage = resolveViewerInitPageIndex(
      bookPages.map((page) => page.pdfPage),
      spread,
      event.data.page,
      currentPageRef.current,
    );
    const page = bookPages[bookPage]?.pdfPage ?? currentPageRef.current;
    currentBookPageRef.current = bookPage;
    currentPageRef.current = page;
    setCurrentBookPage(bookPage);
    setCurrentPage(page);
    renderNearby(page);
  }, [bookPages, renderNearby, setCurrentBookPage, setCurrentPage]);

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
        <div className="reader-heading">
          <Brand compact />
          <Link href="/" className="reader-title" title={title}>{title}</Link>
        </div>
        <p className="reader-page-count" aria-label={`Page ${Math.min(currentPage, pageCount || 1)} of ${pageCount || "unknown"}`}><strong>{Math.min(currentPage, pageCount || 1)}</strong><span> / {pageCount || "—"}</span></p>
        <div className="reader-actions">
          {pdfUrl && <a className="reader-action" href={pdfUrl} download aria-label="Download PDF"><DownloadIcon /><span>Download</span></a>}
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
        <button className="page-arrow page-arrow-left" type="button" onClick={() => turn("previous")} disabled={activeBookPage <= 0} aria-label="Previous page"><ChevronLeftIcon /></button>
        {pageCount > 0 && bookSize && (
          <div className={`book-stage book-stage--${bookPose}`}>
            <HTMLFlipBook
              key={`${bookSize.width}-${bookSize.height}-${bookSize.singlePage}-${bookPages.length}`}
              ref={flipbookRef}
              className="flipbook"
              width={bookSize.width}
              height={bookSize.height}
              size="fixed"
              minWidth={bookSize.width}
              maxWidth={bookSize.width}
              minHeight={bookSize.height}
              maxHeight={bookSize.height}
              startPage={activeBookPage}
              drawShadow={false}
              usePortrait={false}
              singlePage={bookSize.singlePage}
              maxShadowOpacity={0}
              showCover={true}
              renderOnlyPageLengthChange={true}
              onFlip={handleFlip}
              onInit={handleInit}
            >
              {pageElements}
            </HTMLFlipBook>
          </div>
        )}
        <button className="page-arrow page-arrow-right" type="button" onClick={() => turn("next")} disabled={activeBookPage >= bookPages.length - 1} aria-label="Next page"><ChevronRightIcon /></button>
      </section>

    </main>
  );
}
