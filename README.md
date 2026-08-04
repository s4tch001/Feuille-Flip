# Feuille Flip

Feuille Flip turns a PDF into a polished, shareable flipbook. It is designed for people who want
to publish a document quickly without using an editor or managing a complicated publishing system.

**Live app:** [feuille-flip.netlify.app](https://feuille-flip.netlify.app/)

## What the app does

1. Enter a required title.
2. Upload a PDF up to 25 MB.
3. Publish the flipbook with one click.
4. Share the generated public URL.

Titles are converted into URL-safe slugs. For example, `My 2026 Highlights` becomes
`/my-2026-highlights`. Punctuation and symbols are normalized, accents are simplified, and titles
containing only symbols are rejected.

The reader is mobile-first: phones show one page at a time, while larger screens show a centered
two-page book spread. It includes page-turn animation, soft covers, realistic shadows, subtle paper
texture, download, full-screen mode, and social sharing.

## Technology

- **Next.js 16** with the App Router and TypeScript
- **React 19** for the interface and upload flow
- **react-pageflip-enhanced** for the book-style page turning
- **PDF.js** (`pdfjs-dist`) for rendering PDF pages in the browser
- **Supabase** for PostgreSQL metadata, Storage, and signed PDF uploads
- **Netlify** for hosting, server functions, and the scheduled Supabase keep-awake function
- **Zod** for server-side request validation
- **CSS** for the responsive landing page, upload dialog, reader, and iOS Safari adjustments

## Project flow

The browser first requests a short-lived signed upload URL from the server. The PDF then uploads
directly to Supabase Storage. After the upload is verified, the server stores the title, slug, and
file metadata in Supabase. The public reader route loads the PDF and renders it as a flipbook.

## Local development

### Requirements

- Node.js 24
- A Supabase project

### Setup

```bash
npm install
```

Copy `.env.example` to `.env.local` and add:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

The secret key is server-only. Never commit `.env.local` or expose `SUPABASE_SECRET_KEY` to the
browser.

Run the database and Storage setup in Supabase by executing
[`supabase/migrations/20260804000000_create_flipbooks.sql`](supabase/migrations/20260804000000_create_flipbooks.sql)
in the Supabase SQL Editor.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Netlify deployment

1. Push the repository to GitHub, GitLab, or Bitbucket.
2. In Netlify, choose **Add new project → Import an existing project** and select the repository.
3. Use `npm run build` as the build command. Leave the detected Next.js publish settings unchanged.
4. Add the four environment variables above in the Netlify project settings. Set
   `NEXT_PUBLIC_SITE_URL` to `https://feuille-flip.netlify.app` or the final custom domain.
5. Deploy the site.

The scheduled `keep-supabase-awake` function runs every eight hours on the published production
deploy. It performs a small Supabase health query to reduce inactivity-related pauses. This is an
operational workaround, not a replacement for a paid Supabase plan.

## Useful commands

```bash
npm run dev       # Start the development server
npm run lint      # Run ESLint
npm test          # Run the test suite
npm run build     # Create a production build
npm start         # Serve the production build locally
```

## Important notes

- The app intentionally has no accounts. Anyone with the link can open a published flipbook.
- Uploaded PDFs are public by design. Do not upload confidential or sensitive documents.
- Uploads are limited to 25 MB and are checked server-side as PDF files.
- For a high-traffic public launch, add durable rate limiting and an anti-bot challenge such as
  Cloudflare Turnstile.
- Abandoned uploads may leave an unreferenced Storage object; an orphan cleanup job can be added as
  usage grows.
