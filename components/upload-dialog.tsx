"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowRightIcon, CloseIcon, CopyIcon, FileIcon, ShareIcon, UploadIcon } from "@/components/icons";
import { MAX_PDF_BYTES } from "@/lib/constants";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { slugifyTitle } from "@/lib/slug";

type UploadState = "idle" | "uploading" | "publishing" | "success";

type ApiErrorBody = { error?: { message?: string } };
type PresignResponse = { slug: string; storagePath: string; storageToken: string; ticket: string };
type CompleteResponse = { slug: string; url: string };

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
  return body.error?.message ?? "Something went wrong. Please try again.";
}

async function isPdfFile(file: File): Promise<boolean> {
  if (file.type !== "application/pdf" || file.size > MAX_PDF_BYTES || file.size === 0) return false;
  const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...signature) === "%PDF-";
}

export function UploadDialog({ triggerClassName = "button button-primary" }: { triggerClassName?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState("");
  const [publishedPath, setPublishedPath] = useState("");
  const [copied, setCopied] = useState(false);
  const slug = slugifyTitle(title);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  function openDialog() {
    setError("");
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (state === "uploading" || state === "publishing") return;
    dialogRef.current?.close();
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
    setError("");
    if (!title.trim() || !slug) {
      setError("Add a title with at least one letter or number.");
      return;
    }
    if (!file || !(await isPdfFile(file))) {
      setError("Choose a valid PDF up to 25 MB.");
      return;
    }

    try {
      setState("uploading");
      const presignResponse = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
        }),
      });
      if (!presignResponse.ok) throw new Error(await readError(presignResponse));
      const upload = (await presignResponse.json()) as PresignResponse;

      const { error: uploadError } = await getSupabaseBrowserClient().storage
        .from("flipbooks")
        .uploadToSignedUrl(upload.storagePath, upload.storageToken, file, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (uploadError) throw new Error("The PDF upload was interrupted. Please try again.");

      setState("publishing");
      const completeResponse = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: upload.ticket }),
      });
      if (!completeResponse.ok) throw new Error(await readError(completeResponse));

      const published = (await completeResponse.json()) as CompleteResponse;
      setPublishedPath(published.url);
      setState("success");
    } catch (uploadError) {
      setState("idle");
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed. Please try again.");
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
      <button className={triggerClassName} type="button" onClick={openDialog}>
        <UploadIcon /> Upload &amp; flip
      </button>

      <dialog className="upload-dialog" ref={dialogRef} onClick={(event) => {
        if (event.target === dialogRef.current) closeDialog();
      }}>
        <div className="dialog-card">
          <button className="icon-button dialog-close" type="button" onClick={closeDialog} aria-label="Close upload dialog">
            <CloseIcon />
          </button>

          {state === "success" ? (
            <section className="success-panel" aria-live="polite">
              <span className="success-check">✓</span>
              <p className="eyebrow">Your flipbook is live</p>
              <h2>Ready to be shared.</h2>
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
                setState("idle"); setTitle(""); setFile(null); setPublishedPath("");
              }}>Upload another PDF</button>
              <button className="button button-secondary mobile-share" type="button" onClick={nativeShare}><ShareIcon /> Share</button>
            </section>
          ) : (
            <form onSubmit={handleSubmit}>
              <p className="eyebrow">Create your flipbook</p>
              <h2>Turn a PDF into something people want to explore.</h2>
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

              {error && <p className="form-error" role="alert">{error}</p>}

              <button className="button button-primary submit-upload" type="submit" disabled={state !== "idle"}>
                {state === "uploading" ? "Uploading PDF…" : state === "publishing" ? "Publishing flipbook…" : <>Create flipbook <ArrowRightIcon /></>}
              </button>
              <p className="privacy-note">Your flipbook will be public to anyone with the link.</p>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
