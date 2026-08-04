"use client";

import Link from "next/link";

export default function FlipbookError({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <span>Something went wrong</span>
      <h1>We couldn&apos;t open this flipbook.</h1>
      <p>Check your connection, then try once more.</p>
      <div><button className="button button-primary" onClick={reset}>Try again</button><Link className="button button-secondary" href="/">Back home</Link></div>
    </main>
  );
}

