# Austin's site

Next.js App Router, TypeScript, Tailwind CSS 4, deployed on Vercel. Source lives in `~/Code/austin-site`.

## Run

Use Bun 1.3.14 and Node.js 24 LTS (for Next.js), `bun install --frozen-lockfile`, and `bun run dev`. Local dev, tests, and builds need no environment variables: without a Blob token the site renders the committed markdown in `data/posts/`. `bun run sync` needs the `.env.example` values in `.env.local` (Notion token and Blob token). With a Blob token in `.env.local`, `bun run dev` renders the live Blob store instead; set `POSTS_SOURCE=local` to preview the committed snapshot (e.g. after `bun run sync --offline`). Never commit environment files.

Use `bun add <package>`, `bun add --dev <package>`, and `bun remove <package>` to manage dependencies. Commit `bun.lock` with dependency changes. Tests run directly with Bun; no TypeScript loader is needed.

## Designs

Option 4 is the default. The `4` / `5` control in the header remembers the visitor's choice in localStorage. `/?style=5` previews the plum design. Both styles share semantic markup, content, routes, and article rendering. Add an entry to `src/lib/styles.ts`, add scoped CSS to introduce another style. Article text remains server-rendered.

All editorial copy comes from Austin's public Notion content or lorem ipsum. Project names are existing examples, not synced or linked yet. Intro, work, and photos are placeholders. Operational accessibility/error labels describe controls and failures.

## Content pipeline

Notion is the source of truth. Pages never call Notion: they read posts from the Vercel Blob store in production and from the committed snapshot in `data/` otherwise. One sync core (`src/lib/sync.ts`) feeds both. It queries the Posts database, refetches only pages whose `last_edited_time` changed, converts each to markdown with JSON-string frontmatter (`title`, `date`, `notion`, `url`, `excerpt`), and drops pages that are no longer published. A cold pull takes about ten minutes (Notion allows roughly three requests per second and every nested block costs one); an incremental run takes seconds.

**Live store (Blob).** `site/raw/<id>-<hash>.json` (catalog entry plus block tree) and `site/posts/<slug>-<hash>.md` are content-addressed and never overwritten. `site/index.json` lists every live post with its metadata and those two keys. A sync uploads new files first and writes the index last, conditional on the ETag it read at the start. So the index is the single commit point: if anything throws earlier (Notion, media, conversion, an upload), the live site is unchanged; if two syncs race, the slower one fails instead of overwriting. Files no index references are deleted after a day, so readers holding the previous index keep working. The index records the deployment's commit; after a deploy, the next sync reconverts every post from the Blob raw cache (no Notion calls) and revalidates only the posts whose markdown changed. Pages read the index from origin (bypassing the CDN) and markdown through the CDN. A Blob read error fails the render (the build fails, or ISR keeps the previous page). Only a missing index, i.e. a store that was never seeded, falls back to `data/`.

**Publishing.** `/api/sync` (`GET` for Vercel Cron, `POST` for a Notion button) runs the sync against Blob, then calls `revalidatePath` for `/`, `/posts`, and every changed or removed `/posts/<slug>`, so a post goes live within one cron interval or about a second after pressing the button, with no rebuild. The route is open, because a sync can only publish what Notion already marks published, so the Notion button needs no secret. To keep a request loop from exhausting the Notion rate limit, a call without `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this automatically) returns `{"skipped":"cooldown"}` while the index's `syncedAt` (rewritten by every successful sync, even one with no changes) is under 60 s old; calls with the secret always run. The secret is compared in constant time and ignored if shorter than 16 characters. Failures (including an unreadable index) return a generic 500 and log only the error message, which never contains tokens or response bodies. Note the cooldown counts from the last *finished* sync, so calls that arrive while one is running still start their own; the index ETag makes all but one of those fail. The function allows 300 s; after 180 s it stops fetching further changed pages and commits what it has (those keep their previous version, new ones wait) and reports them as `pending`, and the next run continues. `/posts/[slug]` uses ISR with `dynamicParams = true`: slugs published after a build render on first request, and removed slugs revalidate to 404.

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

`vercel.json` schedules `/api/sync` every 15 minutes. Vercel Cron runs only on production deployments, and Hobby plans allow at most daily crons (a deploy with a 15-minute cron fails on Hobby; use `0 0 * * *` there and rely on the button). One-time setup:

1. Production env vars: `NOTION_TOKEN`, `NOTION_DATA_SOURCE_ID` (or `NOTION_DATABASE_ID`), `NOTION_PUBLISH_FILTER`, `NOTION_DATE_PROPERTY`, `NOTION_EXCERPT_PROPERTY`, `BLOB_READ_WRITE_TOKEN` (the `austin-site-images` store), and `CRON_SECRET` (from `openssl rand -hex 32`). Leave `POSTS_SOURCE` unset.
2. Seed the store before (or right after) the first deploy: `bun run sync --blob` locally. Until the index exists the site serves the committed snapshot.
3. Notion button: in the Posts database add a Button (property or page button) with the action **Send webhook** to `https://austin.site/api/sync`, with no headers. Pressing it publishes all pending edits (or reports the cooldown if a sync finished in the last minute). A database automation with the same webhook action also works on Notion plans that support it.
4. Check a run with `curl -H "Authorization: Bearer $CRON_SECRET" https://austin.site/api/sync`. The JSON lists `changed`, `removed`, `pending`, and the revalidated paths; Vercel's Cron Jobs tab shows scheduled runs.
