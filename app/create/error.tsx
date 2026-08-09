"use client";

import Link from "next/link";

export default function CreateError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="error-page">
      <h1>The editor hit a snag.</h1>
      <p>Your locally saved draft is still on this device. You can reopen the workspace safely.</p>
      <div>
        <button className="button button-primary" onClick={reset} type="button">Try again</button>
        <Link className="button button-secondary" href="/">Back to home</Link>
      </div>
    </main>
  );
}
