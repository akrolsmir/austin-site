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
bun run sync                   # mirror Notion → data/ (needs .env.local); add --offline to reconvert from the raw cache
```

The site itself needs no env. Copy `.env.example` to `.env.local` only to run the sync; it throws visibly on any Notion/config error rather than writing a partial mirror.

Deploy: `vercel deploy` (preview) / `vercel deploy --prod` (production, which also activates the cron). Linked to `austin-proj/austin-site`.

## Architecture

Next.js 16 App Router, React 19, Tailwind 4, TypeScript. All pages are server components; the only client component is `StyleSwitch`.

**Content pipeline (Notion → repo → site).** Notion is the source of truth; `data/` is a committed mirror and the site never calls Notion at runtime. `scripts/sync.ts` (`bun run sync`) uses `src/lib/notion-client.ts`, a dependency-free Notion REST client (`createNotionClient(env, fetch)` takes injected env and fetch so tests mock it) that queries the Posts data source with a mandatory publish filter, paginates fully, throttles serially, retries 429/5xx with bounded backoff, and recursively fetches block children without descending into `child_page`/`child_database`. The sync writes `data/posts-raw/<id>.json` (catalog entry plus block tree; refetched only when `last_edited_time` changes), uploads Notion-hosted files to Vercel Blob and stores only the Blob URL in the cache, records each image's intrinsic width/height on its `file`/`external` source (fetched once via `image-size`, also in `--offline` mode), then converts each raw file with `src/lib/notion-markdown.ts` into `data/posts/<slug>.md` (JSON-string frontmatter, see `src/lib/posts.ts`). Files for unpublished pages are deleted. Image dimensions travel as the markdown image title (`![caption](url "WxH")`). `src/lib/posts.ts` reads and parses the markdown directory; `src/components/prose.tsx` renders bodies with `marked` plus `html-react-parser`, swapping sized `<img>` tags for `next/image` (Blob hosts optimized via `images.remotePatterns` in `next.config.ts`, other hosts `unoptimized`, unsized images left as plain `<img>`); `/posts/[slug]` prerenders every post via `generateStaticParams` with `dynamicParams = false`. `/writing` and `/writing/[id]` are permanent redirects for the earlier id-based URLs.

**Fail-closed invariants worth preserving.** `publishFilter` throws on a missing or malformed `NOTION_PUBLISH_FILTER` rather than querying unfiltered. The client also drops archived/trashed and future-dated pages regardless of filter. Truncated query results (`request_status.type === "incomplete"`) throw rather than yielding a partial index, which matters more now because the sync prunes files absent from the index. Error messages never include response bodies or tokens. `safeUrl` in `src/lib/types.ts` only allows http/https/mailto. The converter escapes markdown/HTML characters in Notion text so committed markdown carries no raw HTML from Notion; `marked` renders it without sanitization on that basis. Never hand-edit `data/`; the sync regenerates it.

**Design styles.** `src/lib/styles.ts` is the registry (currently `"4"` default and `"5"` plum). The root layout sets `data-style` on `<html>` and inlines a pre-paint script that reads `?style=` or `localStorage["austin-style"]`. All style-specific CSS lives in `src/app/globals.css` scoped under `[data-style="5"]` selectors; base rules are Option 4. Both styles share identical markup, routes, and server-rendered article content. To add a style: add a registry entry and a matching CSS scope. Nothing else needs to change.

**Notion schema assumptions.** Posts database uses `Tags` (multi-select; `Draft` excluded by the filter), a `Date` formula property, and an `Excerpt` rich-text property. Property names are configurable via `NOTION_DATE_PROPERTY` / `NOTION_EXCERPT_PROPERTY`. Notion API version is pinned to `2026-03-11` and uses the `data_sources` query endpoint.

## Conventions

- Code is deliberately dense: single-line JSX, compact functions, few files. Match that rather than expanding into many small components.
- `README.md` is the authoritative operational doc (Notion rules, sync pipeline, deployment). Update it when behavior changes. `DEVLOG.md` holds Austin's roadmap notes.
- Editorial copy comes only from Austin's public Notion content or lorem ipsum. Intro, projects, and work on the homepage are placeholders. Album photos are in Vercel Blob, listed in `src/lib/photos.json`, added with `bun run photo` (strips EXIF/GPS); see README.
