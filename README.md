# Feuille Flip

Feuille Flip is a local-first page designer and PDF-to-flipbook publisher. A visitor can design a
flipbook from scratch or upload an existing PDF, then publish one public link without creating an
account.

**Live app:** [feuille-flip.netlify.app](https://feuille-flip.netlify.app/)

## Two creation paths

### Create & Flip editor

`/create` provides a responsive, Canva-style canvas workspace:

- A4, US Letter, 16:9 presentation, square, story, and custom page sizes.
- Portrait/landscape selection updates each paper preview immediately; square and custom sizes do not
  show an unnecessary orientation selector.
- The selected width-to-height ratio is retained by the editor, HD export, publisher, and viewer.
- Multiple pages with drag-to-reorder, move controls, add, duplicate, delete, live thumbnails, and a
  100-page project limit.
- Reusable modern cover, editorial, portfolio, minimal, sports, paper-texture, photo-frame, and bold
  social layouts. Layout content automatically centers for the selected page size.
- Font previews and bundled Montserrat, Playfair Display, Bebas Neue, Caveat, Lora, Oswald,
  Pacifico, Nunito, Raleway, and Roboto Slab fonts plus common system fonts.
- Font size, transparent/solid/linear-gradient fills, bold, italic, underline, alignment, rotation,
  and opacity controls.
- Configurable border color, width, and solid/dashed/dotted style for text, shapes, drawing, and
  photos.
- Text outlines with editable color and inside/center/outside placement, plus shadows with editable
  color, eight directions, distance, blur, and spread.
- Rectangles, circles, freehand drawing, object alignment, flipping, layer ordering, grouping, and
  multi-selection.
- Center/edge snapping, rulers, arrow-key nudging, and common undo, redo, duplicate, group, and
  delete keyboard shortcuts.
- A bottom zoom slider with zoom-out, zoom-in, and fit controls. `Ctrl/Cmd +`, `Ctrl/Cmd -`, and
  `Ctrl/Cmd 0` provide the matching keyboard shortcuts.
- Local JPG, PNG, and WebP photos up to 10 MB and 8,000 pixels per dimension.
- Photo filters, circle/rounded masks, original/1:1/4:5/16:9 crops, flipping, rotation, and local
  light-background cleanup.
- HD PNG export and public WebP publishing at a 2,560-pixel long edge.
- A responsive wrapping toolbar and mobile style sheet that keep every editor action visible without
  horizontal toolbar scrolling.

### Upload & Flip

- Accepts valid PDFs up to 25 MB and 300 pages.
- Uploads the original PDF rather than a low-resolution page conversion.
- Uses PDF.js to render visible pages at an adaptive 2x–3x pixel density.
- Derives the viewer ratio from the first PDF page, so portrait, landscape, square, and custom PDF
  sizes remain proportional.
- Keeps older WebP-backed records readable for backward compatibility.

## Local drafts and privacy

Editor drafts do **not** pass through Supabase.

- Project data and embedded local images are autosaved in IndexedDB on the current browser/device.
- Only the last project identifier and a small recent-project index use `localStorage`.
- The editor requests persistent browser storage when the browser supports it.
- A complete project can be downloaded as a `.feuilleflip` JSON file and imported on another
  desktop or mobile device.
- Supabase is contacted only after the user explicitly confirms **Publish**.
- Clearing browser site data removes IndexedDB drafts, so important work should also be saved as a
  `.feuilleflip` file.

## Publishing and sharing

Publishing an editor project renders its pages locally to HD WebP files, obtains short-lived signed
upload URLs, uploads the page assets directly to Supabase Storage, validates them on the server, and
creates a public `/<slug>` link. The success screen supports copy link, native device sharing,
Facebook, X, LinkedIn, and WhatsApp. The public viewer also provides its wider social sharing menu.
After a successful publish, the corresponding local IndexedDB draft and recent-project pointer are
removed from that browser.

PDF publishing follows the same security flow but uploads the original PDF. The server verifies the
stored size, MIME metadata, signed ticket, and `%PDF-` signature before creating the public record.

Every published flipbook is available for exactly three calendar months from its `created_at`
timestamp. For example, a flipbook published on July 15, 2026 expires on October 15, 2026 at the
same UTC time. Month-end dates clamp to the target month's last day (January 31 expires April 30).
The dynamic viewer and sitemap exclude a flipbook at the exact expiry boundary. The existing
Netlify scheduled function removes its Storage objects first and then its database row on the next
run, without relying on the creator's browser. It runs once daily, so physical cleanup normally
follows link expiry within 24 hours and automatically retries partial failures.

## Technology

- **Next.js 16** App Router and TypeScript
- **React 19**
- **Fabric.js 7** for the page editor
- **IndexedDB** through `idb` for local draft persistence
- **PDF.js** (`pdfjs-dist`) for PDF validation and adaptive viewer rendering
- **react-pageflip-enhanced** for page-turn interaction
- **Supabase** PostgreSQL and Storage for explicitly published flipbooks
- **Cloudflare Turnstile** and signed, expiring upload tickets
- **Zod** for API and local project validation
- **Fontsource** for locally bundled editor fonts
- **Vitest** and ESLint
- **Netlify** hosting and scheduled Supabase keep-awake function

## Data flow

### Editor draft

1. The user chooses a page size or custom ratio.
2. Fabric.js serializes every page as canvas JSON.
3. The project autosaves to IndexedDB after local changes.
4. The user can download or re-import a `.feuilleflip` file without an account or server upload.

### Editor publish

1. A freshly rendered Turnstile challenge is exchanged immediately for a short-lived security ticket
   when Turnstile is configured; tokens from prior client-side routes are discarded.
2. The browser renders every page at a 2,560-pixel long edge and keeps its selected ratio.
3. `/api/uploads/presign` validates metadata and returns signed WebP upload URLs.
4. The browser uploads each page directly to the `flipbooks` bucket.
5. `/api/uploads/complete` verifies page count, sequence, size, MIME metadata, and the signed ticket.
6. The server inserts the public record and returns its shareable link.

### PDF publish

1. The browser checks the file type, size, `%PDF-` signature, page count, and whether PDF.js can open
   the first page.
2. The security and presign APIs return a signed URL for `uploads/<uuid>.pdf`.
3. The original PDF uploads directly to Supabase Storage.
4. The completion API verifies Storage metadata and reads the stored signature before publishing.
5. The viewer renders visible PDF pages on demand at the appropriate desktop/mobile density.

## Limits

| Item | Limit |
| --- | ---: |
| PDF file | 25 MB |
| PDF pages | 300 |
| Editor pages | 100 |
| Editor photo | 10 MB |
| Editor photo dimension | 8,000 px |
| Imported project file | 50 MB |
| Published WebP page | 2 MB |
| Published WebP total | 25 MB |
| Editor publish resolution | 2,560 px long edge |
| Published flipbook retention | 3 calendar months |

## Local development

### Requirements

- Node.js 24
- A Supabase project
- A Cloudflare Turnstile widget configured for `localhost`, `127.0.0.1`, and every production host

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

`SUPABASE_SECRET_KEY` and `TURNSTILE_SECRET_KEY` are server-only. Never commit `.env.local` or expose
either value to browser code.

Run the database migrations in order in the Supabase SQL Editor:

1. [`supabase/migrations/20260804000000_create_flipbooks.sql`](supabase/migrations/20260804000000_create_flipbooks.sql)
2. [`supabase/migrations/20260805000000_add_webp_flipbook_pages.sql`](supabase/migrations/20260805000000_add_webp_flipbook_pages.sql)

The second migration allows both `application/pdf` and `image/webp` objects and adds the page-asset
metadata used by editor-created flipbooks.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Useful commands

```bash
npm run dev       # Start the development server
npm run lint      # Run ESLint with zero warnings allowed
npm run test      # Run the Vitest suite
npm run build     # Create a production build
npm run start     # Serve the production build locally
```

## Project routes

- `/` — landing page and PDF upload entry point
- `/create` — local-first page editor
- `/[slug]` — public flipbook viewer
- `/api/uploads/authorize` — Turnstile verification and security-ticket creation
- `/api/uploads/presign` — signed PDF or WebP upload URL creation
- `/api/uploads/complete` — stored asset validation and public record creation
- `/robots.txt` — generated crawler rules
- `/sitemap.xml` — generated public sitemap

## Deployment

1. Import the repository into Netlify.
2. Use `npm run build` as the build command.
3. Keep the detected Next.js settings.
4. Add all six environment variables listed above.
5. Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS origin.
6. Make sure `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` come from the same Turnstile
   widget and are available to the Production build and Functions runtime. Redeploy after changing
   either value.
7. Add every deployed hostname to the Turnstile widget.
8. Run both Supabase migrations before accepting uploads.

Turnstile widget success only means the browser minted a token; publishing succeeds only after the
server validates that token. The authorize route records sanitized Cloudflare error codes in server
logs and distinguishes a deployment-key problem from an expired or duplicate user challenge.

The scheduled `netlify/functions/keep-supabase-awake.mts` function runs once daily at 01:00 UTC. Its
retention scan is also the small health query that helps avoid inactivity-related pauses, so cleanup
does not require another scheduled invocation or a user visit. Keep this function enabled on the
published Netlify deployment.

## Important notes

- The app has no accounts. Anyone with a published link can open that public flipbook.
- Published links stop resolving exactly three calendar months after publication. Storage and
  database deletion follow automatically on the next scheduled cleanup run.
- Never publish confidential or sensitive documents; published assets are public by design.
- Existing low-resolution WebP pages cannot regain missing detail. Republish the original PDF to use
  adaptive high-density rendering.
- Mixed-size PDFs use the first page as the flipbook frame ratio because the page-turn engine requires
  one consistent page size.
- Abandoned or interrupted publishing attempts may leave unreferenced Storage objects; add a scheduled
  orphan cleanup task as usage grows.

## Third-party notices

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for licensing information.
