import type { Metadata, Viewport } from "next";
import Script from "next/script";

import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Feuille Flip — Your PDF, made to flip", template: "%s · Feuille Flip" },
  description: "Turn any PDF into a beautiful, mobile-friendly flipbook and share it with one simple link.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: "Feuille Flip — Your PDF, made to flip",
    description: "Upload a PDF. Get a beautiful shareable flipbook. No editor needed.",
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
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" />
        )}
      </body>
    </html>
  );
}
