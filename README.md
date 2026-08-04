# Feuille Flip

A mobile-first Next.js 16 app that turns an uploaded PDF into a public Turn.js flipbook. There is
no editor: add a required title, upload a PDF, and share the generated title-based URL.

Example: `My 2026 Highlights` becomes `/my-2026-highlights`. Punctuation is normalized, `&`
becomes `and`, accents are simplified, repeated separators are collapsed, and symbols-only titles
are rejected.

## Local setup

1. Install Node.js 24, then install the locked dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project and follow the Supabase steps below.

3. Copy `.env.example` to `.env.local` and fill in the four values.

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000`, upload a PDF, and open its generated link.

## Supabase: step-by-step

1. Sign in at [supabase.com](https://supabase.com), choose **New project**, and create a project.
   Save the database password somewhere safe; the app does not need it directly.

2. In the project sidebar, open **SQL Editor** and choose **New query**.

3. Open
   [`supabase/migrations/20260804000000_create_flipbooks.sql`](supabase/migrations/20260804000000_create_flipbooks.sql),
   copy all of it into the query editor, then click **Run**. This creates:

   - the `flipbooks` metadata table;
   - a unique index for title slugs;
   - Row Level Security with no public database mutation policy;
   - a public `flipbooks` Storage bucket limited to PDF files up to 25 MB.

4. Open **Table Editor** and confirm that `public.flipbooks` exists.

5. Open **Storage** and confirm that the `flipbooks` bucket exists and is public. Public access is
   intentional because every published flipbook is shareable by URL. Uploads still require a
   short-lived signed token issued by the server.

6. Open **Project Settings → API Keys** (the label may appear as **Data API** on some dashboards).
   Copy these values:

   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Publishable key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Secret key (`sb_secret_...`) → `SUPABASE_SECRET_KEY`

   The secret key is server-only. Never prefix it with `NEXT_PUBLIC_`, paste it into client code,
   commit it, or share it in screenshots.

7. Optional Supabase smoke test: upload one PDF from the local app, then confirm that a row appears
   in `flipbooks` and a randomly named `.pdf` appears under Storage → `flipbooks/uploads`.

## Netlify: step-by-step

1. Push this folder to a GitHub, GitLab, or Bitbucket repository. Do not commit `.env.local`.

2. Sign in at [Netlify](https://app.netlify.com), select **Add new project → Import an existing
   project**, connect the repository, and select it.

3. Netlify should detect Next.js. Use these build settings:

   - Build command: `npm run build`
   - Publish directory: leave the detected Next.js value unchanged
   - Base directory: leave blank when this project is at the repository root

   The included `netlify.toml` pins Node.js 24 and the build command.

4. Before deploying, open **Project configuration → Environment variables** and add:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
   | `SUPABASE_SECRET_KEY` | Supabase secret key (`sb_secret_...`) |
   | `NEXT_PUBLIC_SITE_URL` | Final URL, for example `https://feuille-flip.netlify.app` |

   Apply them to production. Mark `SUPABASE_SECRET_KEY` as containing a secret value. For a public
   repository, do not expose the production secret to untrusted deploy previews.

5. If you do not know the final Netlify URL yet, set the desired site name under **Domain
   management**, use that `.netlify.app` URL for `NEXT_PUBLIC_SITE_URL`, then deploy. With a custom
   domain, change `NEXT_PUBLIC_SITE_URL` to the custom HTTPS URL and redeploy so canonical and share
   links are correct.

6. Select **Deploy project**. Wait for the deploy to finish, then open the production URL.

7. Confirm the keep-awake cron:

   - Go to **Functions** and open `keep-supabase-awake`.
   - It should show a **Scheduled** badge and the next run time.
   - The cron runs every eight hours at `01:00`, `09:00`, and `17:00 UTC` (`09:00`, `17:00`, and
     `01:00` the following day in Manila).
   - Click **Run now** once. In the function log, confirm:
     `Supabase keep-awake health query succeeded.`

   Scheduled functions run automatically only on the published production deploy. This health query
   is a practical inactivity workaround, not a contractual availability guarantee. A paid Supabase
   plan is the supported way to prevent inactivity pausing entirely.

8. Run the production smoke test:

   - Open the landing page on a phone and desktop.
   - Click **Upload & flip**.
   - Enter `My 2026 Highlights`, choose a valid PDF under 25 MB, and publish.
   - Confirm the generated route is `/my-2026-highlights`.
   - Open the link on mobile: the reader should fill the viewport and show one page at a time.
   - On a real iPhone, scroll the landing page until Safari collapses its address bar, then
     rubber-band at the top. Confirm the sticky navbar reaches behind the browser chrome without
     transparent corner gaps.
   - Open it on desktop: it should show a two-page spread.
   - Test page turning, previous/next, download, full screen, copy link, and social-share links.

## Commands

```bash
npm run test
npm run lint
npm run build
```

## Operational notes

- The app intentionally has no accounts. Anyone can request an upload, so for a public launch with
  significant traffic, add a durable rate limiter and an anti-bot challenge such as Turnstile.
- Standard uploads are limited to 25 MB. The browser uploads directly to Supabase with a one-time
  signed token, avoiding Netlify Functions' buffered request-size limit.
- Uploaded PDFs are public by design. Do not upload confidential or personal documents.
- Turn.js 4.1.0 is vendored from the supplied Turn.js 4 archive; keep that original archive and
  review [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) before commercial distribution.
- If an upload is abandoned before publishing, the Storage object may remain. A periodic orphan
  cleanup job is a sensible later addition if volume grows.
