import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { ArrowRightIcon, FileIcon, SparkIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Create & Flip",
  description: "Start a new flipbook and choose the page size that fits your story.",
  alternates: { canonical: "/create" },
};

const pageSizes = [
  { name: "Document", detail: "A4 or Letter", ratio: "portrait" },
  { name: "Presentation", detail: "Widescreen 16:9", ratio: "landscape" },
  { name: "Social", detail: "Square or story", ratio: "square" },
];

export default function CreatePage() {
  return (
    <main className="create-entry-shell">
      <header className="create-entry-header container">
        <Brand />
        <Link className="create-back-link" href="/">Back to home</Link>
      </header>

      <section className="create-entry container">
        <div className="create-entry-copy">
          <p className="eyebrow"><SparkIcon /> Create &amp; flip</p>
          <h1>Your blank page is ready.</h1>
          <p>Choose a starting shape for your flipbook. The full page editor—with text, photos, drawing, layers, and local autosave—is the next workspace being built here.</p>
          <div className="create-local-note">
            <FileIcon />
            <span><strong>Local-first by design.</strong> Drafts will stay on this device and will only use online storage when you publish.</span>
          </div>
        </div>

        <div className="create-size-panel" aria-label="Planned page size choices">
          <span className="create-size-label">Choose a page size</span>
          <div className="create-size-grid">
            {pageSizes.map((size) => (
              <div className="create-size-option" key={size.name}>
                <span className={`create-size-preview create-size-preview-${size.ratio}`} aria-hidden="true" />
                <strong>{size.name}</strong>
                <small>{size.detail}</small>
              </div>
            ))}
          </div>
          <p className="create-size-status">Editor controls and project creation are coming in the next build step.</p>
          <Link className="button button-secondary" href="/#choose-your-start">Compare both starting options <ArrowRightIcon /></Link>
        </div>
      </section>
    </main>
  );
}
