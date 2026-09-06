# Austin's site

Next.js App Router, TypeScript, Tailwind CSS 4, deployed on Vercel. Source lives in `~/Code/austin-site`.

## Run

Use Bun 1.3.14 and Node.js 24 LTS (for Next.js), `bun install --frozen-lockfile`, and `bun run dev`. The site needs no environment variables: it renders from the committed markdown in `data/posts/`. Only `bun run sync` needs `.env.example` values in `.env.local` (Notion token and Blob token). Never commit environment files.

Use `bun add <package>`, `bun add --dev <package>`, and `bun remove <package>` to manage dependencies. Commit `bun.lock` with dependency changes. Tests run directly with Bun; no TypeScript loader is needed.

## Designs

Option 4 is the default. The `4` / `5` control in the header remembers the visitor's choice in localStorage. `/?style=5` previews the plum design. Both styles share semantic markup, content, routes, and article rendering. Add an entry to `src/lib/styles.ts`, add scoped CSS to introduce another style. Article text remains server-rendered.

All editorial copy comes from Austin's public Notion content or lorem ipsum. Project names are existing examples, not synced or linked yet. Intro, work, and photos are placeholders. Operational accessibility/error labels describe controls and failures.

## Content pipeline

Notion is the source of truth; the repo holds a mirror. `bun run sync` (`scripts/sync.ts`) queries the Posts database, writes each published page's block JSON to `data/posts-raw/<notion id>.json`, converts it to `data/posts/<slug>.md` with JSON-string frontmatter (`title`, `date`, `notion`, `url`, `excerpt`), and deletes files for pages that are no longer published. Commit the result; the site prerenders every post from `data/posts/` at build time and never calls Notion at runtime. Publishing therefore means running the sync and pushing.

The sync is incremental: a page is refetched only when its `last_edited_time` differs from the cached raw file, so a typical run takes seconds rather than the ten minutes of a cold pull (Notion allows roughly three requests per second and every nested block costs one). `bun run sync --offline` reconverts markdown from the raw cache without contacting Notion, which is how to iterate on the converter. Never hand-edit `data/`; it is regenerated.

Notion-hosted files (images, video, audio, PDFs) are copied to the Vercel Blob store `austin-site-images` under `posts/<page id>/<block id>-<edit time>.<ext>` and the raw cache stores only the Blob URL, so committed files carry no expiring signed URLs. Existing keys are skipped; a replaced image gets a new key. External image URLs are left as they are.

Every image block also gets its intrinsic width and height recorded in the raw cache (fetched once with `image-size`, in both online and offline mode) and written into the markdown as the image title, e.g. `![caption](url "1200x800")`. The site renders images with `next/image` using those dimensions, so pages reserve layout before images load; Blob-hosted images go through the Next image optimizer and other hosts are served unoptimized so the optimizer never proxies arbitrary URLs. An image that cannot be fetched or decoded is logged and rendered as a plain `<img>` rather than failing the sync.

Slugs derive from titles (`src/lib/posts.ts`), so retitling a post moves its URL; `/writing/<notion id>` links from the earlier design permanently redirect to the current slug, and `/writing` redirects to `/posts`. Duplicate titles get a short id suffix.

## Notion publication rules

The integration needs read content access to the Posts database. Its verified schema uses `Tags` (multi-select with `Draft`) and a `Date` formula combining Manual Date and Created time. The configured filter excludes Draft, and the client also excludes archived/trashed and future-dated posts. The filter is mandatory: a missing or malformed filter never produces an unfiltered query. Truncated query results throw rather than producing a partial mirror, which would otherwise delete posts.

Index and recursive block requests paginate fully and retry 429/5xx responses with bounded backoff. Child pages/databases are not traversed. The converter (`src/lib/notion-markdown.ts`) escapes markdown and HTML characters in text, so committed markdown contains only the tags the converter itself emits (`<u>`), and rejects non-web link schemes. Headings shift down one level so the title is the only h1. Columns and synced blocks flatten, toggles become a bold line, callouts become blockquotes, equations are emitted as `$…$`, and unsupported blocks link to the original in Notion. Markdown is rendered with `marked` at build time.

## Verification

`bun run lint`, `bun run typecheck`, `bun test`, `bun run build`. To serve the production build locally, use `bun run start`.

## Deployment

Vercel installs dependencies with `bun install --frozen-lockfile` and builds with `bun run build`, as configured in `vercel.json`.

Linked to `austin-proj/austin-site`. The deployed site needs no environment variables. `vercel deploy` creates a preview; `vercel deploy --prod` deploys production. Tokens stay in `.env.local` and out of Git.
