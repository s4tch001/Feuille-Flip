import type { Metadata, Viewport } from "next";

import { TurnstileScript } from "@/components/turnstile-script";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Feuille Flip — Create, flip, and share", template: "%s · Feuille Flip" },
  description: "Create pages from scratch or turn a PDF into a beautiful, mobile-friendly flipbook with one shareable link.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: "Feuille Flip — Create, flip, and share",
    description: "Design pages from scratch or upload a PDF, then publish a beautiful shareable flipbook.",
    url: "/",
    siteName: "Feuille Flip",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f6f2",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
          <TurnstileScript />
        )}
      </body>
    </html>
  );
}
