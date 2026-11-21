# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Bun 1.3.14 + Node 24 (see `.nvmrc`). Use `bun add` / `bun add --dev` / `bun remove` for dependencies and commit `bun.lock`.

```sh
bun install --frozen-lockfile
bun run dev                    # next dev
bun run lint                   # eslint (next core-web-vitals + typescript)
bun run typecheck              # tsc --noEmit
bun test                       # all tests (tests/*.test.ts, written with node:test + node:assert, run by Bun)
bun test tests/notion.test.ts  # one file
bun test -t "fail closed"      # one test by name pattern
bun run build && bun run start # production build / serve
bun run sync                   # mirror Notion → data/ (needs .env.local); --offline reconverts from the raw cache; --blob also pushes to the live Blob store
```

Local dev, tests, and builds need no env (without `BLOB_READ_WRITE_TOKEN` the site reads `data/`; `POSTS_SOURCE=local` forces that). Copy `.env.example` to `.env.local` only to run the sync; it throws visibly on any Notion/config error rather than writing a partial mirror.

Deploy: `vercel deploy` (preview) / `vercel deploy --prod` (production). Linked to `austin-proj/austin-site`. Vercel Cron (`vercel.json`, every 15 min, which needs a Pro plan) calls `/api/sync` on production deployments only. Production env and one-time setup are in README → Deployment.

## Architecture

Next.js 16 App Router, React 19, Tailwind 4, TypeScript. All pages are server components; the only client component is `StyleSwitch`.

**Content pipeline (Notion → Blob/repo → site).** Notion is the source of truth; pages never call Notion. `src/lib/sync.ts` is the one sync core, run by `/api/sync` (Vercel Cron GET or Notion button POST, against the Blob store) and by `scripts/sync.ts` (against the committed `data/` snapshot, optionally pushed to Blob with `--blob`). Stores stage writes and persist them only in `commit`. In Blob, `site/raw/*.json` and `site/posts/*.md` are content-addressed and `site/index.json` (written last, `ifMatch` the ETag read at load) is the single commit point; the index records the deploy's commit so a new build reconverts from the Blob raw cache. The route authenticates `CRON_SECRET`/`SYNC_SECRET` in constant time, stops fetching after 180 s (rest reported `pending`), and `revalidatePath`s `/`, `/posts`, and changed/removed slugs. `src/lib/posts.ts` reads Blob when `BLOB_READ_WRITE_TOKEN` is set (index from origin, markdown via CDN, memoized by content key) and falls back to `data/posts` otherwise or when the index is missing; Blob read errors throw. The core uses `src/lib/notion-client.ts`, a dependency-free Notion REST client (`createNotionClient(env, fetch)` takes injected env and fetch so tests mock it) that queries the Posts data source with a mandatory publish filter, paginates fully, throttles serially, retries 429/5xx with bounded backoff, and recursively fetches block children without descending into `child_page`/`child_database`. For the snapshot, the sync writes `data/posts-raw/<id>.json` (catalog entry plus block tree; refetched only when `last_edited_time` changes), uploads Notion-hosted files to Vercel Blob and stores only the Blob URL in the cache, records each image's intrinsic width/height on its `file`/`external` source (fetched once via `image-size`, also in `--offline` mode), then converts each raw file with `src/lib/notion-markdown.ts` into `data/posts/<slug>.md` (JSON-string frontmatter, see `src/lib/posts.ts`). Files for unpublished pages are deleted. Image dimensions travel as the markdown image title (`![caption](url "WxH")`). `src/components/prose.tsx` renders bodies with `marked` plus `html-react-parser`, swapping sized `<img>` tags for `next/image` (Blob hosts optimized via `images.remotePatterns` in `next.config.ts`, other hosts `unoptimized`, unsized images left as plain `<img>`); `/posts/[slug]` prerenders every post via `generateStaticParams` and uses ISR with `dynamicParams = true`, so new slugs render on demand and removed ones revalidate to 404. `/writing` and `/writing/[id]` are permanent redirects for the earlier id-based URLs.

**Fail-closed invariants worth preserving.** `publishFilter` throws on a missing or malformed `NOTION_PUBLISH_FILTER` rather than querying unfiltered. The client also drops archived/trashed and future-dated pages regardless of filter. Truncated query results (`request_status.type === "incomplete"`) throw rather than yielding a partial index, which matters because the sync prunes posts absent from the index. Nothing is committed to either store if any step throws, and `/api/sync` refuses all requests when no secret of at least 16 characters is configured. Error messages never include response bodies or tokens. `safeUrl` in `src/lib/types.ts` only allows http/https/mailto. The converter escapes markdown/HTML characters in Notion text so committed markdown carries no raw HTML from Notion; `marked` renders it without sanitization on that basis. Never hand-edit `data/` or the Blob `site/` prefix; the sync regenerates them.

**Design styles.** `src/lib/styles.ts` is the registry (currently `"4"` default and `"5"` plum). The root layout sets `data-style` on `<html>` and inlines a pre-paint script that reads `?style=` or `localStorage["austin-style"]`. All style-specific CSS lives in `src/app/globals.css` scoped under `[data-style="5"]` selectors; base rules are Option 4. Both styles share identical markup, routes, and server-rendered article content. To add a style: add a registry entry and a matching CSS scope. Nothing else needs to change.

**Notion schema assumptions.** Posts database uses `Tags` (multi-select; `Draft` excluded by the filter), a `Date` formula property, and an `Excerpt` rich-text property. Property names are configurable via `NOTION_DATE_PROPERTY` / `NOTION_EXCERPT_PROPERTY`. Notion API version is pinned to `2026-03-11` and uses the `data_sources` query endpoint.

## Conventions

- Code is deliberately dense: single-line JSX, compact functions, few files. Match that rather than expanding into many small components.
- `README.md` is the authoritative operational doc (Notion rules, sync pipeline, deployment). Update it when behavior changes. `DEVLOG.md` holds Austin's roadmap notes.
- Editorial copy comes only from Austin's public Notion content or lorem ipsum. Intro, projects, work, and photos on the homepage are placeholders.
