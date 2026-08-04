import Link from "next/link";

export default function NotFound() {
  return (
    <main className="error-page">
      <span>404 · Page not found</span>
      <h1>This flipbook isn&apos;t here.</h1>
      <p>The link may be incomplete, or the flipbook may have been removed.</p>
      <Link className="button button-primary" href="/">Create a flipbook</Link>
    </main>
  );
}

