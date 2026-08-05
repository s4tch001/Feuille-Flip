"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowRightIcon, CloseIcon, CopyIcon, FileIcon, ShareIcon, UploadIcon } from "@/components/icons";
import { MAX_PDF_BYTES, MAX_WEBP_PAGE_BYTES, MAX_WEBP_PAGE_COUNT, MAX_WEBP_TOTAL_BYTES, WEBP_PAGE_WIDTH, WEBP_QUALITY } from "@/lib/constants";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { slugifyTitle } from "@/lib/slug";

type UploadState = "idle" | "preparing" | "uploading" | "publishing" | "success";

type ApiErrorBody = { error?: { message?: string } };
type RenderedPage = { index: number; blob: Blob; fileSize: number };
type RenderedPdf = { pageCount: number; pageWidth: number; pageHeight: number; pages: RenderedPage[] };
type PresignResponse = {
  slug: string;
  pageStoragePrefix: string;
  pageUploads: Array<{ index: number; storagePath: string; storageToken: string }>;
  ticket: string;
};
type CompleteResponse = { slug: string; url: string };
const OPEN_UPLOAD_DIALOG_EVENT = "feuille:open-upload-dialog";
const TURNSTILE_SCRIPT_ID = "cf-turnstile-script";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, params: {
        sitekey: string;
        action: string;
        callback: (token: string) => void;
        "error-callback": (code: string) => void;
        "expired-callback": () => void;
      }) => string;
      ready: (callback: () => void) => void;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
  return body.error?.message ?? "Something went wrong. Please try again.";
}

async function isPdfFile(file: File): Promise<boolean> {
  if (file.type !== "application/pdf" || file.size > MAX_PDF_BYTES || file.size === 0) return false;
  const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...signature) === "%PDF-";
}

function canvasToWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("This browser could not render the PDF pages."));
      else resolve(blob);
    }, "image/webp", WEBP_QUALITY);
  });
}

async function renderPdfToWebp(file: File): Promise<RenderedPdf> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loadingTask.promise;
  try {
    if (pdf.numPages > MAX_WEBP_PAGE_COUNT) throw new Error(`PDFs are limited to ${MAX_WEBP_PAGE_COUNT} pages.`);

    const pages: RenderedPage[] = [];
    let pageWidth = 0;
    let pageHeight = 0;

    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = WEBP_PAGE_WIDTH / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("This browser could not render the PDF pages.");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await canvasToWebp(canvas);
      if (blob.type !== "image/webp") throw new Error("This browser does not support WebP export. Try Chrome, Edge, or Safari 14+.");
      if (blob.size > MAX_WEBP_PAGE_BYTES) throw new Error("One rendered page is too large. Try a simpler or smaller PDF.");
      pages.push({ index, blob, fileSize: blob.size });
      if (pages.reduce((total, item) => total + item.fileSize, 0) > MAX_WEBP_TOTAL_BYTES) {
        throw new Error("Rendered pages are too large. Try a smaller PDF.");
      }
      if (index === 1) {
        pageWidth = canvas.width;
        pageHeight = canvas.height;
      }
      canvas.width = 0;
      canvas.height = 0;
    }

    return { pageCount: pdf.numPages, pageWidth, pageHeight, pages };
  } finally {
    await loadingTask.destroy();
  }
}

export function UploadTrigger({ className = "button button-primary" }: { className?: string }) {
  return (
    <button className={className} type="button" onClick={() => window.dispatchEvent(new Event(OPEN_UPLOAD_DIALOG_EVENT))}>
      <UploadIcon /> Upload &amp; flip
    </button>
  );
}

export function UploadDialog() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetRef = useRef<string | null>(null);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState("");
  const [publishedPath, setPublishedPath] = useState("");
  const [copied, setCopied] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileGeneration, setTurnstileGeneration] = useState(0);
  const [turnstileScriptReady, setTurnstileScriptReady] = useState(false);
  const slug = slugifyTitle(title);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  useEffect(() => {
    if (!turnstileSiteKey) return;
    if (window.turnstile) {
      window.setTimeout(() => setTurnstileScriptReady(true), 0);
      return;
    }

    let cancelled = false;
    const existingScript = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existingScript ?? document.createElement("script");

    function markReady() {
      script.dataset.loaded = "true";
      if (!cancelled) setTurnstileScriptReady(true);
    }

    function markFailed() {
      if (!cancelled) setError("Security check could not load. Please refresh and try again.");
    }

    script.addEventListener("load", markReady);
    script.addEventListener("error", markFailed);

    if (script.dataset.loaded === "true") {
      markReady();
    } else if (!existingScript) {
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      script.removeEventListener("load", markReady);
      script.removeEventListener("error", markFailed);
    };
  }, [turnstileSiteKey]);

  useEffect(() => {
    if (!dialogOpen || !turnstileSiteKey || !turnstileScriptReady || !window.turnstile || !turnstileRef.current || turnstileWidgetRef.current) return;
    const siteKey = turnstileSiteKey;
    let cancelled = false;

    try {
      window.turnstile.ready(() => {
        if (cancelled || turnstileWidgetRef.current || !turnstileRef.current) return;
        try {
          turnstileWidgetRef.current = window.turnstile!.render(turnstileRef.current, {
            sitekey: siteKey,
            action: "turnstile-spin-v1",
            callback: (token) => {
              setTurnstileToken(token);
              setError("");
            },
            "error-callback": (code) => {
              setTurnstileToken("");
              setError(`Security check failed (${code}). Check your Turnstile site key and allowed domains.`);
            },
            "expired-callback": () => {
              setTurnstileToken("");
              setError("Security check expired. Please complete it again.");
            },
          });
        } catch {
          setTurnstileToken("");
          setError("Security check could not load. Please refresh and try again.");
        }
      });
    } catch {
      window.setTimeout(() => {
        setTurnstileToken("");
        setError("Security check could not load. Please refresh and try again.");
      }, 0);
    }

    return () => {
      cancelled = true;
    };
  }, [dialogOpen, turnstileGeneration, turnstileScriptReady, turnstileSiteKey]);

  useEffect(() => {
    function openDialog() {
      setError("");
      setDialogOpen(true);
      if (window.turnstile) setTurnstileScriptReady(true);
    }

    window.addEventListener(OPEN_UPLOAD_DIALOG_EVENT, openDialog);
    return () => window.removeEventListener(OPEN_UPLOAD_DIALOG_EVENT, openDialog);
  }, []);

  function resetTurnstile() {
    setTurnstileToken("");
    try {
      window.turnstile?.reset(turnstileWidgetRef.current ?? undefined);
    } catch {
      disposeTurnstile();
    }
  }

  function disposeTurnstile() {
    if (turnstileWidgetRef.current) {
      try {
        window.turnstile?.remove(turnstileWidgetRef.current);
      } catch {
        // The widget can already be gone if the modal unmounted during a script callback.
      }
    }
    turnstileWidgetRef.current = null;
    turnstileRef.current?.replaceChildren();
    setTurnstileToken("");
  }

  function closeDialog() {
    if (state === "preparing" || state === "uploading" || state === "publishing") return;
    setDialogOpen(false);
    disposeTurnstile();
    setState("idle");
    setTitle("");
    setFile(null);
    setPublishedPath("");
    setError("");
  }

  async function selectFile(selected: File | undefined) {
    setError("");
    if (!selected) return;
    if (!(await isPdfFile(selected))) {
      setFile(null);
      setError("Choose a valid PDF up to 25 MB.");
      return;
    }
    setFile(selected);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const formToken = formData.get("cf-turnstile-response");
    const securityToken = turnstileToken || (typeof formToken === "string" ? formToken : "");
    setError("");
    if (!title.trim() || !slug) {
      setError("Add a title with at least one letter or number.");
      return;
    }
    if (!file || !(await isPdfFile(file))) {
      setError("Choose a valid PDF up to 25 MB.");
      return;
    }
    if (turnstileSiteKey && !securityToken) {
      setError("Complete the security check before uploading.");
      return;
    }

    try {
      setState("preparing");
      const rendered = await renderPdfToWebp(file);

      setState("uploading");
      const presignResponse = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          turnstileToken: securityToken || undefined,
          pageCount: rendered.pageCount,
          pageWidth: rendered.pageWidth,
          pageHeight: rendered.pageHeight,
          pages: rendered.pages.map((page) => ({ index: page.index, fileSize: page.fileSize })),
        }),
      });
      if (!presignResponse.ok) throw new Error(await readError(presignResponse));
      const upload = (await presignResponse.json()) as PresignResponse;

      const uploadTargets = new Map(upload.pageUploads.map((page) => [page.index, page]));
      for (const page of rendered.pages) {
        const target = uploadTargets.get(page.index);
        if (!target) throw new Error("Upload could not be prepared. Please try again.");
        const { error: uploadError } = await getSupabaseBrowserClient().storage
          .from("flipbooks")
          .uploadToSignedUrl(target.storagePath, target.storageToken, page.blob, {
            contentType: "image/webp",
            upsert: false,
          });
        if (uploadError) throw new Error(`Page ${page.index} could not upload: ${uploadError.message}`);
      }

      setState("publishing");
      const completeResponse = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: upload.ticket }),
      });
      if (!completeResponse.ok) throw new Error(await readError(completeResponse));

      const published = (await completeResponse.json()) as CompleteResponse;
      disposeTurnstile();
      setPublishedPath(published.url);
      setState("success");
    } catch (uploadError) {
      setState("idle");
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed. Please try again.");
      resetTurnstile();
    }
  }

  const absoluteUrl = typeof window === "undefined" || !publishedPath
    ? ""
    : new URL(publishedPath, window.location.origin).toString();

  async function copyLink() {
    await navigator.clipboard.writeText(absoluteUrl);
    setCopied(true);
  }

  async function nativeShare() {
    if (navigator.share) {
      await navigator.share({ title, text: `Flip through ${title}`, url: absoluteUrl });
    } else {
      await copyLink();
    }
  }

  return (
    <>
      {dialogOpen && <div className="upload-dialog-backdrop" onPointerDown={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}>
      <section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-dialog-title">
        <div className="dialog-card">
          <button className="icon-button dialog-close" type="button" onClick={closeDialog} aria-label="Close upload dialog">
            <CloseIcon />
          </button>

          {state === "success" ? (
            <section className="success-panel" aria-live="polite">
              <span className="success-check">✓</span>
              <p className="eyebrow">Your flipbook is live</p>
              <h2 id="upload-dialog-title">Ready to be shared.</h2>
              <p className="muted">Anyone with this public link can open your flipbook.</p>
              <div className="published-link">
                <span>{absoluteUrl}</span>
                <button type="button" onClick={copyLink}><CopyIcon /> {copied ? "Copied" : "Copy"}</button>
              </div>
              <div className="share-row" aria-label="Share flipbook">
                <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(absoluteUrl)}`} target="_blank" rel="noreferrer">Facebook</a>
                <a href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(absoluteUrl)}&text=${encodeURIComponent(title)}`} target="_blank" rel="noreferrer">X / Twitter</a>
                <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(absoluteUrl)}`} target="_blank" rel="noreferrer">LinkedIn</a>
              </div>
              <a className="button button-primary success-open" href={publishedPath}>Open flipbook <ArrowRightIcon /></a>
              <button className="text-button" type="button" onClick={() => {
                setState("idle"); setTitle(""); setFile(null); setPublishedPath(""); setTurnstileGeneration((generation) => generation + 1);
              }}>Upload another PDF</button>
              <button className="button button-secondary mobile-share" type="button" onClick={nativeShare}><ShareIcon /> Share</button>
            </section>
          ) : (
            <form onSubmit={handleSubmit}>
              <p className="eyebrow">Create your flipbook</p>
              <h2 id="upload-dialog-title">Turn a PDF into something people want to explore.</h2>
              <p className="muted">No editor. No setup. Add a title, choose your PDF, and publish.</p>

              <label className="field-label" htmlFor="flipbook-title">Title <span>Required</span></label>
              <input
                id="flipbook-title"
                className="text-input"
                value={title}
                onChange={(event) => setTitle(event.target.value.slice(0, 80))}
                placeholder="My 2026 Highlights"
                required
                maxLength={80}
                disabled={state !== "idle"}
              />
              <p className="slug-preview"><span>Your link</span> /{slug || "my-2026-highlights"}</p>

              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => void selectFile(event.target.files?.[0])}
                disabled={state !== "idle"}
              />
              <button
                className={`drop-zone ${file ? "has-file" : ""}`}
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); void selectFile(event.dataTransfer.files[0]); }}
                disabled={state !== "idle"}
              >
                <span className="drop-icon">{file ? <FileIcon /> : <UploadIcon />}</span>
                <strong>{file ? file.name : "Choose a PDF or drop it here"}</strong>
                <small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · Ready to flip` : "PDF only · Maximum 25 MB"}</small>
              </button>
              <p className="pdf-size-note">Best results: use A4 portrait for every page.</p>

              {turnstileSiteKey && (
                <div className="turnstile-field">
                  <div ref={turnstileRef} />
                </div>
              )}

              {error && <p className="form-error" role="alert">{error}</p>}

              <button className="button button-primary submit-upload" type="submit" disabled={state !== "idle"}>
                {state === "preparing" ? "Rendering pages…" : state === "uploading" ? "Uploading pages…" : state === "publishing" ? "Publishing flipbook…" : <>Create flipbook <ArrowRightIcon /></>}
              </button>
              <p className="privacy-note">Your flipbook will be public to anyone with the link.</p>
            </form>
          )}
        </div>
      </section>
      </div>}
    </>
  );
}
