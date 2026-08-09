import Image from "next/image";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { ArrowRightIcon, FileIcon, ShareIcon, SparkIcon, UploadIcon } from "@/components/icons";
import { TurnstileGate } from "@/components/turnstile-gate";
import { UploadDialog, UploadTrigger } from "@/components/upload-dialog";
import heroImage from "@/public/images/hero.webp";

export default function HomePage() {
  return (
    <main>
      <header className="site-header">
        <nav className="site-nav container" aria-label="Main navigation">
          <Brand />
          <div className="site-nav-actions">
            <UploadTrigger className="button button-secondary nav-action nav-upload" />
            <Link className="button button-primary nav-action nav-create" href="/create">
              <SparkIcon /> Create &amp; flip
            </Link>
          </div>
        </nav>
      </header>

      <section className="hero container">
        <div className="hero-copy">
          <div className="hero-pill"><SparkIcon /> Create from scratch or bring a PDF</div>
          <h1>Create it.<br /><em>Flip it. Share it.</em></h1>
          <p>Design every page yourself or upload a finished PDF. Either way, your layout keeps its proportions and becomes a beautiful, shareable flipbook.</p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/create"><SparkIcon /> Create &amp; flip</Link>
            <UploadTrigger className="button button-secondary" />
          </div>
          <TurnstileGate />
          <p className="hero-note"><span>✓</span> No account needed <i /> <span>✓</span> Drafts stay on your device <i /> <span>✓</span> Mobile ready</p>
        </div>

        <figure className="hero-art">
          <Image
            src={heroImage}
            alt="A preview of a page-turning digital magazine"
            priority
            sizes="(min-width: 760px) 48vw, 92vw"
          />
          <figcaption className="hero-art-note">
            <span>Any page size</span>
            <strong>Always kept in proportion.</strong>
          </figcaption>
        </figure>
      </section>

      <section className="start-section" id="choose-your-start">
        <div className="container">
          <p className="eyebrow centered">Two ways to begin</p>
          <h2 className="section-title">Start with a blank page—or one you already made.</h2>
          <div className="start-grid">
            <article className="start-card start-card-create">
              <div className="start-card-heading">
                <span className="start-icon"><SparkIcon /></span>
                <small>New</small>
              </div>
              <h3>Design it in Feuille Flip</h3>
              <p>Choose a page size, then add text, photos, shapes, drawings, and more. Your progress saves locally while you work.</p>
              <ul aria-label="Create and Flip features">
                <li>Flexible page sizes and layouts</li>
                <li>Photos, typography, shapes, and drawing</li>
                <li>Local autosave before publishing</li>
              </ul>
              <Link className="button button-primary" href="/create">Open the editor <ArrowRightIcon /></Link>
            </article>

            <article className="start-card">
              <div className="start-card-heading">
                <span className="start-icon"><UploadIcon /></span>
                <small>Fastest</small>
              </div>
              <h3>Turn your PDF into a flipbook</h3>
              <p>Bring a finished document and publish it in seconds. Its original page proportions carry straight into the viewer.</p>
              <ul aria-label="Upload and Flip features">
                <li>PDFs up to 25 MB</li>
                <li>Portrait, landscape, square, or custom ratio</li>
                <li>One public link, ready to share</li>
              </ul>
              <UploadTrigger className="button button-secondary" />
            </article>
          </div>
        </div>
      </section>

      <section className="how-section" id="how-it-works">
        <div className="container">
          <p className="eyebrow centered">How it works</p>
          <h2 className="section-title">From first page to page-turner.</h2>
          <div className="steps-grid">
            <article><span className="step-icon"><SparkIcon /></span><small>01</small><h3>Choose how to start</h3><p>Create your pages in the editor or upload a PDF that is already finished.</p></article>
            <article><span className="step-icon"><FileIcon /></span><small>02</small><h3>Make it yours</h3><p>Keep the size and layout you chose, add a title, and preview the result.</p></article>
            <article><span className="step-icon"><ShareIcon /></span><small>03</small><h3>Publish and share</h3><p>Get your own public link and share it directly to your favorite platforms.</p></article>
          </div>
          <div className="bottom-cta">
            <div><span>Ready when you are.</span><h2>Make your first flipbook your way.</h2></div>
            <div className="bottom-cta-actions">
              <Link className="button button-primary" href="/create"><SparkIcon /> Create &amp; flip</Link>
              <UploadTrigger className="button button-secondary button-on-dark" />
            </div>
          </div>
        </div>
      </section>

      <footer className="site-footer container">
        <Brand />
        <p>Pages deserve a little more life.</p>
        <span>© {new Date().getFullYear()} Feuille Flip</span>
      </footer>
      <UploadDialog />
    </main>
  );
}
