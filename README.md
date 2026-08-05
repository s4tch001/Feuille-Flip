# Feuille Flip

Feuille Flip turns a PDF into a polished, shareable flipbook without requiring an account or an
editor.

**Live app:** [feuille-flip.netlify.app](https://feuille-flip.netlify.app/)

## Features

- Uploads valid PDFs up to 25 MB.
- Converts PDF pages to WebP in the browser before upload.
- Supports up to 300 rendered pages, with a 1,600 px target page width.
- Publishes a unique, URL-safe slug from the title.
- Uses a two-page spread on wide screens and a single-page reader on mobile and tablet.
- Provides page-turn animation, cover handling, soft mobile folds, paper shadows, download, full-screen mode, and responsive controls.
- Protects uploads with Cloudflare Turnstile on the landing page.
- Provides share links for Facebook, X, LinkedIn, WhatsApp, Telegram, Reddit, Pinterest, Bluesky, and Tumblr.
- Keeps older PDF-backed flipbooks readable while new flipbooks use WebP page assets.

## Technology

- **Next.js 16** with the App Router and TypeScript
- **React 19** for the interface and upload flow
- **react-pageflip-enhanced** for the MIT-licensed page-flip engine
- **PDF.js** (`pdfjs-dist`) for browser-side PDF validation and rendering
- **Supabase** for PostgreSQL metadata, Storage, signed upload URLs, and public page assets
- **Cloudflare Turnstile** for upload authorization and server-side token verification
- **Font Awesome Free Brands** for social sharing icons
- **Zod** for server-side request validation
- **Netlify** for hosting and the scheduled Supabase keep-awake function
- **CSS** for the responsive landing page, reader, modal, and mobile behavior

## Upload flow

1. The landing page loads one Turnstile widget. The upload dialog does not create or reload its own widget.
2. The browser validates the selected file as a PDF and checks the file signature.
3. The browser exchanges the Turnstile token at `/api/uploads/authorize` for a short-lived signed security ticket.
4. PDF.js renders each PDF page to WebP in the browser.
5. `/api/uploads/presign` validates the upload metadata and security ticket, then creates Supabase signed upload URLs for the WebP pages.
6. The browser uploads the WebP pages directly to the `flipbooks` Supabase Storage bucket.
7. `/api/uploads/complete` verifies the signed upload ticket and uploaded page metadata, then inserts the flipbook record.
8. The reader prefers WebP pages and falls back to the original PDF for older records.

The Turnstile token is consumed before the expensive PDF rendering and Storage upload work begins,
so the challenge is not part of the long-running upload operation.

## Local development

### Requirements

- Node.js 24
- A Supabase project
- A Cloudflare Turnstile widget configured for `localhost`, `127.0.0.1`, and the production hostname

### Setup

```bash
npm install
```

Copy `.env.example` to `.env.local` and set:

```env
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SECRET_KEY=your-secret-key
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-turnstile-site-key
TURNSTILE_SECRET_KEY=your-turnstile-secret-key
```

`SUPABASE_SECRET_KEY` and `TURNSTILE_SECRET_KEY` are server-only secrets. Never commit `.env.local`
or expose either value to the browser.

Run both database migrations in order in the Supabase SQL Editor:

1. [`supabase/migrations/20260804000000_create_flipbooks.sql`](supabase/migrations/20260804000000_create_flipbooks.sql)
2. [`supabase/migrations/20260805000000_add_webp_flipbook_pages.sql`](supabase/migrations/20260805000000_add_webp_flipbook_pages.sql)

The second migration updates the `flipbooks` bucket to allow both `application/pdf` and `image/webp`.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Netlify deployment

1. Import the repository into Netlify.
2. Use `npm run build` as the build command.
3. Keep the detected Next.js settings unchanged.
4. Add all six environment variables listed above in Netlify project settings.
5. Set `NEXT_PUBLIC_SITE_URL` to `https://feuille-flip.netlify.app` or the final custom domain.
6. Deploy the site.

The scheduled `netlify/functions/keep-supabase-awake.mts` function runs three times daily and performs
a small Supabase health query. It is an operational workaround for inactivity-related pauses, not a

## Useful commands

```bash
npm run dev       # Start the development server
npm run lint      # Run ESLint with zero warnings allowed
npm run test      # Run the Vitest suite
npm run build     # Create a production build
npm run start     # Serve the production build locally
```

## Project routes

- `/` - landing page and upload entry point
- `/[slug]` - public flipbook reader
- `/api/uploads/authorize` - verifies Turnstile and issues an upload security ticket
- `/api/uploads/presign` - validates metadata and creates signed WebP upload URLs
- `/api/uploads/complete` - validates uploaded pages and publishes the flipbook
- `/robots.txt` - generated crawler rules
- `/sitemap.xml` - generated public sitemap

## Important notes

- The app intentionally has no accounts. Anyone with a published link can open that flipbook.
- Published flipbook assets are public by design. Do not upload confidential or sensitive documents.
- PDF uploads are limited to 25 MB; each WebP page is limited to 2 MB and the rendered page total is limited to 25 MB.
- New uploads are image-based WebP flipbooks. Existing PDF-backed records remain supported as a fallback.
- Turnstile must include every deployed hostname in its widget configuration, including the Netlify hostname and any custom domain.
- Abandoned uploads can leave unreferenced Storage objects; an orphan cleanup job can be added as usage grows.

## Third-party notices

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the `react-pageflip-enhanced` license notice.
