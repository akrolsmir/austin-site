# Austin's site

Next.js App Router, TypeScript, Tailwind CSS 4, deployed on Vercel. Posts come from Notion; the owner edits everything else on the site itself (see Editable site). Source lives in `~/Code/austin-site`.

## Run

Use Bun 1.3.14 and Node.js 24 LTS (for Next.js), `bun install --frozen-lockfile`, and `bun run dev`. Local dev, tests, and builds need no environment variables: without a Blob token the site renders the committed markdown in `data/posts/`. `bun run sync` needs the `.env.example` values in `.env.local` (Notion token and Blob token). To work on the editor or `/studio` UI without OAuth, run `EDITOR_DEV_OWNER=1 bun run dev` (the editor needs a Blob token to publish and the studio needs `DATABASE_URL` to store anything; without them both show their quiet unavailable states). With a Blob token in `.env.local`, `bun run dev` renders the live Blob store instead; set `POSTS_SOURCE=local` to preview the committed snapshot (e.g. after `bun run sync --offline`). Never commit environment files.

Use `bun add <package>`, `bun add --dev <package>`, and `bun remove <package>` to manage dependencies. Commit `bun.lock` with dependency changes. Tests run directly with Bun; no TypeScript loader is needed.

## Editable site

The owner can change the site from the site. `docs/editable-site.md` is the contract and the as-built notes; this is the operating summary. All of it is optional: without the variables below the site is the plain static site, with no sign-in, editor, or studio.

**Slots and theme.** Everything editable is a slot declared in `src/site/schema.ts` (text, lists, section order, colours, fonts, sizes), with defaults in `src/site/content.json` and `src/site/theme.json`. Pages read slots through `getSite()` and render them with `<E id>` / `data-e` attributes; theme slots become CSS variables in the root layout. Adding a slot is a code change; changing its value is not.

**Overlay.** Published values that differ from the code defaults live in Vercel Blob under `site/overlay/` as immutable versions plus a head (current version and history, up to 200 entries). Publishing validates every value against the schema, writes a new version, commits a new head, and revalidates the whole site; nothing rebuilds. A lost race is a 409, never a silent overwrite. `POSTS_SOURCE=local` or no Blob token means defaults only.

**Sign-in.** `/sign-in` offers GitHub sign-in (Better Auth, sessions in Neon Postgres). Anyone can complete it, but only the GitHub account whose numeric id is `OWNER_GITHUB_ID` is the owner; every write route checks that server side. A non-secret `editor=1` cookie only decides whether the browser downloads the editor.

**Editor bar.** For the owner, every page gets a bar: click any text to edit it in place, open Customize for colours, type, layout, lists and section order, Publish or Discard the draft (kept in this browser's `localStorage` until published), History to go back to any earlier version or to the defaults, and "Ask Claude" to take a question about the page or a piece of text to the studio. Post bodies are not editable here; the bar links to the post in Notion. Visitors download none of it.

**/studio.** A public, read-only record of the owner's conversations with Claude about the site (threads or single messages can be marked private). Only the owner can write. Each message starts a run, shown as a card with a live checklist and Stop, Revert, Publish, and Discard where they apply. One run is active at a time; later ones queue.

- **Fast lane** (seconds): Claude answers, or publishes slot values through the same overlay the editor uses. Revert points the site back at the version before the run.
- **Code lane** (minutes): for changes that need code, Claude works in a Vercel Sandbox on a clone of the repo, runs typecheck, lint, tests, and build, and the server commits the result to a `studio/<id>` branch and opens a pull request. The sandbox holds only the Anthropic key and a per-run token, never GitHub, database, Blob, or auth secrets. A pull request that touches only `src/site/content.json`, `src/site/theme.json`, or stylesheets merges by itself once its Vercel preview succeeds; anything else waits for the owner to press Publish (merge) or Discard (close) after looking at the preview. Revert opens and merges a revert pull request. At most 30 code runs per 24 hours.

Runs move forward on studio page views and on a cron (`/api/studio/tick`, every 10 minutes), so a preview that finishes while nobody is watching still merges. That cron wakes a scale-to-zero Neon database every 10 minutes; drop it from `vercel.json` if that matters more than unattended merges.

### Environment variables

| Variable | Needed for | Purpose |
| --- | --- | --- |
| `NOTION_TOKEN` | sync | Notion integration token (read access to the Posts database). |
| `NOTION_DATA_SOURCE_ID` / `NOTION_DATABASE_ID` | sync | The Posts data source (preferred) or database. |
| `NOTION_PUBLISH_FILTER` | sync | Mandatory Notion filter JSON for what counts as published. |
| `NOTION_DATE_PROPERTY`, `NOTION_EXCERPT_PROPERTY` | sync | Property names (default `Date`, `Excerpt`). |
| `BLOB_READ_WRITE_TOKEN` | live posts, overlay, editor images, photos | The Vercel Blob store. Without it the site renders `data/` and code defaults. |
| `POSTS_SOURCE` | local preview | `local` forces `data/` and defaults even with a Blob token. |
| `CRON_SECRET` | crons | Vercel Cron sends it; lets `/api/sync` skip its cooldown. At least 16 characters. |
| `DATABASE_URL` | sign-in, studio | Neon Postgres connection string. |
| `BETTER_AUTH_SECRET` | sign-in | Session signing secret (`openssl rand -hex 32`). |
| `BETTER_AUTH_URL` | sign-in, studio | The site's public origin, e.g. `https://austin.site`. Also the origin the studio fetches pages from and the sandbox calls back to. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | sign-in | The GitHub OAuth app. |
| `OWNER_GITHUB_ID` | sign-in | Numeric GitHub user id of the owner (default `856034`). |
| `ANTHROPIC_API_KEY` | studio | Both lanes; the only secret passed into the sandbox. |
| `STUDIO_FAST_MODEL`, `STUDIO_CODE_MODEL` | studio | Model overrides (defaults `claude-sonnet-5-5`, `claude-opus-5-5`). |
| `GITHUB_TOKEN` | code lane | Fine-grained token the server uses for branches, pull requests, and merges. |
| `GITHUB_REPO` | code lane | `owner/name` (default `akrolsmir/austin-site`). |
| `EDITOR_DEV_OWNER` | local dev | `1` makes you the owner without signing in. Ignored when `NODE_ENV=production`. |

Vercel sets `VERCEL_ENV`, `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_GIT_COMMIT_SHA`, and `VERCEL_DEPLOYMENT_ID` itself, and the Sandbox SDK authenticates with the deployment's own OIDC token. **Scope every secret above to the Production environment only** and keep Deployment Protection on for previews: preview deployments are built from branches Claude wrote, and they should hold no secrets. As a second guard, the code turns sign-in, the studio, and the database off on any non-production Vercel deployment.

### First-time setup

1. **Database.** Add Neon from the Vercel Marketplace to the project (Production only); it sets `DATABASE_URL`. Put the same value in `.env.local` and run `bun run db:push` to create the tables. Run it again after any change to `src/db/schema.ts`.
2. **GitHub OAuth app** (GitHub → Settings → Developer settings → OAuth Apps): homepage `<BETTER_AUTH_URL>`, callback `<BETTER_AUTH_URL>/api/auth/callback/github`. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and `OWNER_GITHUB_ID` if the owner is not the default.
3. **Anthropic key.** Create a key in a workspace with a monthly spend limit and set `ANTHROPIC_API_KEY`. The key enters the sandbox, where an agent runs code, so the limit is the backstop.
4. **GitHub token** for the code lane: a fine-grained personal access token limited to this one repository with Contents (read and write), Pull requests (read and write), and Deployments (read); Metadata (read) comes with it. Set `GITHUB_TOKEN` and `GITHUB_REPO`. The repository must be public (the sandbox clones it without credentials) and connected to the Vercel project's Git integration with preview deployments on, because the code lane merges only after Vercel reports a successful preview for the pull request. If `main` is protected, the token's owner must be allowed to merge.
5. **Vercel Sandbox.** Nothing to configure on a Vercel deployment beyond the plan allowing Sandbox; it authenticates with the deployment's OIDC token. The code lane does not run from a laptop unless `vercel env pull` has provided one.
6. **Firewall.** `/api/studio/*` reads are public and each touches the database at most once per few seconds per instance. Add a Vercel WAF rate limit on `/api/studio/` and `/api/sync` (for example 60 requests a minute per IP) so a loop cannot keep Neon awake or the functions busy.
7. Deploy to production, then run the smoke tests.

### Smoke tests (once the keys exist)

1. `/sign-in` → Continue with GitHub → back on the site with the editor bar. A second GitHub account signs in and gets no bar and a 401 from `POST /api/overlay`.
2. Click the homepage intro, change a word, Publish. Reload in a private window: the change is live. History → Revert: it is gone. History → Back to defaults works too.
3. Customize → change the link colour; Publish; check `/posts` picked it up; revert.
4. `/studio`: ask "what is the homepage intro?" (an answer, no card), then "make the footer say hello" (a card, Published, the footer changed; Revert restores it). Open the thread in a private window: readable, no composer. Post one private message and confirm the private window does not show it.
5. Ask for something that needs code ("add a /now page with one line"). Expect steps from the sandbox, a pull request, a preview link, and a card waiting at "Ready to publish". Open the preview, press Publish, see the merge and the production deploy. Then Revert and see the revert pull request merge.
6. Ask for a colour change "in the code defaults" (a bake): the pull request touches only `theme.json`, merges by itself after the preview, and after the deploy the overlay entry disappears from History's current version (the first owner page load prunes it).
7. Press Stop on a running code run; it ends as Stopped within two minutes. Start a code run and press Discard at "Ready to publish"; the pull request closes.
8. `curl -H "Authorization: Bearer $CRON_SECRET" https://austin.site/api/studio/tick` answers `{"ok":true}`; the Cron Jobs tab shows both crons.

All editorial copy comes from Austin's public Notion content or lorem ipsum. Project names are existing examples, not synced or linked yet. Intro and work are placeholders. Operational accessibility/error labels describe controls and failures.

## Photos

`/photos` is the album; the homepage shows the two newest. Images live in the same Vercel Blob store as post images, under `photos/<content hash>.jpg`, and `src/lib/photos.json` lists each one's URL, size, month, and alt text, newest first. Add one with `bun run photo <file.jpg> --alt "what it shows" [--date YYYY-MM]` (needs `BLOB_READ_WRITE_TOKEN` in `.env.local`), then commit `photos.json`. The script strips all EXIF/GPS/XMP before upload (`src/lib/jpeg.ts`) and refuses photos whose EXIF orientation isn't upright, since stripping would publish them sideways; run `convert -auto-orient` on those first. The date defaults to the EXIF capture month.

## Content pipeline

Notion is the source of truth. Pages never call Notion: they read posts from the Vercel Blob store in production and from the committed snapshot in `data/` otherwise. One sync core (`src/lib/sync.ts`) feeds both. It queries the Posts database, refetches only pages whose `last_edited_time` changed, converts each to markdown with JSON-string frontmatter (`title`, `date`, `notion`, `url`, `excerpt`), and drops pages that are no longer published. A cold pull takes about ten minutes (Notion allows roughly three requests per second and every nested block costs one); an incremental run takes seconds.

**Live store (Blob).** `site/raw/<id>-<hash>.json` (catalog entry plus block tree) and `site/posts/<slug>-<hash>.md` are content-addressed and never overwritten. The index lists every live post with its metadata and those two keys. Because public Blob reads go through a CDN, an overwritten file can be read stale, so the index is never overwritten either: each sync writes a new pointer file `site/index/<sequence>-<tag>.json`, creation fails if that sequence number already exists, and readers find the newest by listing (a legacy `site/index.json` is still read when no pointer exists). A sync uploads new files first and writes the pointer last. So the pointer is the single commit point: if anything throws earlier (Notion, media, conversion, an upload), the live site is unchanged; if two syncs race, the slower one fails instead of overwriting. Raw and post files no index references are deleted after a day, so readers holding the previous index keep working; the 20 newest pointers are kept; nothing else under `site/` (the overlay, editor images) is touched. The index records the deployment's commit; after a deploy, the next sync reconverts every post from the Blob raw cache (no Notion calls) and revalidates only the posts whose markdown changed. Blob reads time out after 8 s. A Blob read error fails the render (the build fails, or ISR keeps the previous page). Only a missing index, i.e. a store that was never seeded, falls back to `data/`.

**Publishing.** `/api/sync` (`GET` for Vercel Cron, `POST` for a Notion button) runs the sync against Blob, then calls `revalidatePath` for `/`, `/posts`, and every changed or removed `/posts/<slug>`, so a post goes live within one cron interval or about a second after pressing the button, with no rebuild. The route is open, because a sync can only publish what Notion already marks published, so the Notion button needs no secret. To keep a request loop from exhausting the Notion rate limit, a call without `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this automatically) returns `{"skipped":"cooldown"}` while the index's `syncedAt` (rewritten by every successful sync, even one with no changes) is under 60 s old; calls with the secret always run. The secret is compared in constant time and ignored if shorter than 16 characters. Failures (including an unreadable index) return a generic 500 and log only the error message, which never contains tokens or response bodies. Each server instance also runs at most one unauthenticated sync at a time and starts at most one per 60 s; across instances, calls that arrive while a sync is running can still start their own, and the pointer write makes all but one of those fail. The function allows 300 s; after 180 s it stops fetching further changed pages and commits what it has (those keep their previous version, new ones wait) and reports them as `pending`, and the next run continues. `/posts/[slug]` uses ISR with `dynamicParams = true`: slugs published after a build render on first request, and removed slugs revalidate to 404.

**Snapshot (`data/`).** `bun run sync` (`scripts/sync.ts`) runs the same core against `data/posts-raw/<notion id>.json` and `data/posts/<slug>.md`, writing only files whose bytes changed. Committing it keeps a git history of the content and a fallback for builds without Blob. `bun run sync --offline` reconverts from the raw cache without contacting Notion, which is how to iterate on the converter. `bun run sync --blob` additionally pushes the snapshot to the live store (no extra Notion calls), which is how to seed Blob with a cold sync or publish from a laptop. Never hand-edit `data/` or the Blob `site/` prefix; syncs regenerate them.

Notion-hosted files (images, video, audio, PDFs) are copied to the Vercel Blob store `austin-site-images` under `posts/<page id>/<block id>-<edit time>.<ext>` and the raw cache stores only the Blob URL, so neither store carries expiring signed URLs. Existing keys are skipped; a replaced image gets a new key. External image URLs are left as they are.

Every image block also gets its intrinsic width and height recorded in the raw cache (fetched once with `image-size`, in both online and offline mode) and written into the markdown as the image title, e.g. `![caption](url "1200x800")`. The site renders images with `next/image` using those dimensions, so pages reserve layout before images load; Blob-hosted images go through the Next image optimizer and other hosts are served unoptimized so the optimizer never proxies arbitrary URLs. An image that cannot be fetched or decoded is logged and rendered as a plain `<img>` rather than failing the sync.

Slugs derive from titles (`src/lib/posts.ts`), so retitling a post moves its URL; `/writing/<notion id>` links from the earlier design permanently redirect to the current slug, and `/writing` redirects to `/posts`. Duplicate titles get a short id suffix.

## Notion publication rules

The integration needs read content access to the Posts database. Its verified schema uses `Tags` (multi-select with `Draft`) and a `Date` formula combining Manual Date and Created time. The configured filter excludes Draft, and the client also excludes archived/trashed and future-dated posts. The filter is mandatory: a missing or malformed filter never produces an unfiltered query. Truncated query results throw rather than producing a partial mirror, which would otherwise delete posts.

Index and recursive block requests paginate fully and retry 429/5xx responses with bounded backoff. Child pages/databases are not traversed. The converter (`src/lib/notion-markdown.ts`) escapes markdown and HTML characters in text, so committed markdown contains only the tags the converter itself emits (`<u>`), and rejects non-web link schemes. Headings shift down one level so the title is the only h1. Columns and synced blocks flatten, toggles become a bold line, callouts become blockquotes, equations are emitted as `$…$`, and unsupported blocks link to the original in Notion. Markdown is rendered with `marked` at build time.

## Verification

`bun run lint`, `bun run typecheck`, `bun test`, `bun run build`. To serve the production build locally, use `bun run start`.

## Deployment

Vercel installs dependencies with `bun install --frozen-lockfile` and builds with `bun run build`, as configured in `vercel.json`.

Linked to `austin-proj/austin-site`. `vercel deploy` creates a preview; `vercel deploy --prod` deploys production. Tokens stay in `.env.local`, Vercel env vars, and out of Git.

`vercel.json` schedules `/api/sync` every 15 minutes and `/api/studio/tick` every 10 (see Editable site). Vercel Cron runs only on production deployments, and Hobby plans allow at most daily crons (a deploy with a 15-minute cron fails on Hobby; use `0 0 * * *` there and rely on the button). One-time setup:

1. Production env vars: `NOTION_TOKEN`, `NOTION_DATA_SOURCE_ID` (or `NOTION_DATABASE_ID`), `NOTION_PUBLISH_FILTER`, `NOTION_DATE_PROPERTY`, `NOTION_EXCERPT_PROPERTY`, `BLOB_READ_WRITE_TOKEN` (the `austin-site-images` store), and `CRON_SECRET` (from `openssl rand -hex 32`). Leave `POSTS_SOURCE` unset.
2. Seed the store before (or right after) the first deploy: `bun run sync --blob` locally. Until the index exists the site serves the committed snapshot.
3. Notion button: in the Posts database add a Button (property or page button) with the action **Send webhook** to `https://austin.site/api/sync`, with no headers. Pressing it publishes all pending edits (or reports the cooldown if a sync finished in the last minute). A database automation with the same webhook action also works on Notion plans that support it.
4. Check a run with `curl -H "Authorization: Bearer $CRON_SECRET" https://austin.site/api/sync`. The JSON lists `changed`, `removed`, `pending`, and the revalidated paths; Vercel's Cron Jobs tab shows scheduled runs.
