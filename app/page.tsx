import { Brand } from "@/components/brand";
import { ArrowRightIcon, FileIcon, ShareIcon, SparkIcon, UploadIcon } from "@/components/icons";
import { UploadDialog } from "@/components/upload-dialog";

export default function HomePage() {
  return (
    <main>
      <header className="site-header">
        <nav className="site-nav container" aria-label="Main navigation">
          <Brand />
          <UploadDialog triggerClassName="button button-primary nav-upload" />
        </nav>
      </header>

      <section className="hero container">
        <div className="hero-copy">
          <div className="hero-pill"><SparkIcon /> Simple PDF publishing</div>
          <h1>Your PDF,<br /><em>made to flip.</em></h1>
          <p>Upload a PDF and turn it into a beautiful, shareable flipbook in seconds. No editor, no learning curve.</p>
          <div className="hero-actions">
            <UploadDialog />
            <a className="hero-link" href="#how-it-works">See how it works <ArrowRightIcon /></a>
          </div>
          <p className="hero-note"><span>✓</span> No account needed <i /> <span>✓</span> Mobile ready</p>
        </div>

        <div className="hero-art" aria-label="A preview of a page-turning digital magazine">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="art-spark spark-one">✦</span>
          <span className="art-spark spark-two">✦</span>
          <div className="book-shadow" />
          <div className="book-page page-back"><span>11</span></div>
          <div className="book-page page-left">
            <small>THE YEAR IN</small>
            <strong>COLOR</strong>
            <div className="page-photo photo-one" />
            <div className="page-copy-lines"><i /><i /><i /></div>
          </div>
          <div className="book-page page-right">
            <span className="page-number">08</span>
            <div className="page-photo photo-two"><b>2026</b></div>
            <h3>Moments worth<br />remembering.</h3>
            <p>A small collection of the days that made this year unforgettable.</p>
          </div>
          <div className="turning-page"><span>FLIP</span></div>
          <div className="art-badge"><span>↗</span><strong>Share anywhere</strong><small>One beautiful link</small></div>
        </div>
      </section>

      <section className="how-section" id="how-it-works">
        <div className="container">
          <p className="eyebrow centered">How it works</p>
          <h2 className="section-title">From PDF to page-turner in three steps.</h2>
          <div className="steps-grid">
            <article><span className="step-icon"><UploadIcon /></span><small>01</small><h3>Upload your PDF</h3><p>Choose any PDF up to 25 MB. That&apos;s the only file you need.</p></article>
            <article><span className="step-icon"><FileIcon /></span><small>02</small><h3>Give it a title</h3><p>Your title becomes a clean, memorable link people can open anywhere.</p></article>
            <article><span className="step-icon"><ShareIcon /></span><small>03</small><h3>Share your flipbook</h3><p>Copy your link or share it straight to your favorite social platform.</p></article>
          </div>
          <div className="bottom-cta">
            <div><span>Ready when you are.</span><h2>Make your first flipbook.</h2></div>
            <UploadDialog />
          </div>
        </div>
      </section>

      <footer className="site-footer container">
        <Brand />
        <p>PDFs deserve a little more life.</p>
        <span>© {new Date().getFullYear()} Feuille Flip</span>
      </footer>
    </main>
  );
}
