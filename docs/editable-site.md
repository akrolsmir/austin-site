# Editable site: architecture and contracts

Austin edits the site while on it: directly (an editor bar over the real pages) or by prompt (`/studio`, a public chat with the site). This file is the contract every part builds against. Keep it current when behavior changes.

## Layers (one writer each)

| Layer | Holds | Written by | Live in |
| --- | --- | --- | --- |
| Git | code, `src/site/content.json`, `src/site/theme.json` (defaults) | code-lane agent commits | a deploy (~1 min) |
| Blob overlay | published slot values | Publish (editor bar or fast-lane agent) | ~1 s, `revalidatePath("/", "layout")` |
| Browser draft | unpublished slot values | the owner's editor, `localStorage["site-draft"]` | instantly, owner's screen only |
| Notion → Blob posts | essays | the sync | read-only on the site |

A page renders `defaults ← overlay`. The editor applies `← draft` client-side.

**The site must keep working with no env at all** (local dev, tests, build): no Blob token means an empty overlay, no `DATABASE_URL` means auth and studio are "not configured" and render a quiet empty state. Nothing may throw at import time for a missing env var.

## Slots (`src/site/`)

- `content.json`: flat `{ [slotId]: value }` of copy and structure defaults. `theme.json`: flat `{ [tokenId]: value }` of design tokens. Slot ids are dotted lowercase (`home.intro`, `theme.accent`); theme slot ids all start with `theme.`.
- `schema.ts` exports:
  - `type SlotKind = "text" | "url" | "image" | "color" | "length" | "number" | "font" | "order" | "list"`
  - `type SlotDef = { kind: SlotKind; label: string; group: string; ...constraints }`. Constraints by kind: `text` `{ max: number; multiline?: boolean }`; `length` `{ min, max, unit: "px" | "rem" | "em" | "" }` (value is a number); `number` `{ min, max, step }`; `font` (value is a key of the exported `fonts` registry); `order` `{ items: string[] }` (value is a subset of `items` in display order; an omitted item is hidden); `list` `{ fields: Record<string, { kind: "text" | "url"; label: string; max?: number }>; maxItems: number }` (value is `Array<{ id: string } & fields>`); `image` (value `{ url, width, height, alt }`, url must pass `safeUrl` and be https); `url` (must pass `safeUrl`); `color` (`#rgb`/`#rrggbb` only).
  - `slots: Record<string, SlotDef>`: the registry. Every key of content.json and theme.json has a def, and a test asserts that and that every default validates.
  - `validateValue(def, value): { ok: true; value } | { ok: false; error: string }`: pure, strict, never throws.
  - `type Overlay = Record<string, unknown>`; `resolveSite(overlay?: Overlay): { values: Record<string, unknown>; dropped: string[] }`: defaults with each valid overlay entry applied; an entry whose slot is unknown or whose value fails validation is listed in `dropped` and ignored (fail closed to the default).
  - `themeCss(values): string`: the `:root{--token:value;…}` declaration for all theme slots. CSS variable name for `theme.foo-bar` is `--foo-bar`.
- `src/site/index.ts` (server): `getSite(): Promise<Site>` reads the published overlay (see below; empty without Blob) and returns helpers `text(id)`, `value<T>(id)`, `list(id)`, `order(id)`. React-`cache`d per render.
- Markup contract (what the editor relies on):
  - An element showing a text slot carries `data-e="<slotId>"` and its text content is exactly the slot value. Use the `<E id as? className? />` server component from `src/site/e.tsx`.
  - A `url` slot's element carries `data-e-href="<slotId>"`; an `image` slot's `<img>` carries `data-e-img="<slotId>"`.
  - A list slot's container carries `data-e-list="<slotId>"`, each item `data-e-item="<item id>"`, and each field element inside `data-e-field="<field>"`.
  - A reorderable/hideable section carries `data-section="<item id>"` inside a container with `data-e-order="<slotId>"`.
  - The root layout injects `<style id="site-theme">{themeCss(values)}</style>`; all of `globals.css` reads tokens through CSS variables, so the editor previews a token by setting the variable on `document.documentElement`.
- Values are rendered as React text and CSS variable values only. Never `dangerouslySetInnerHTML` a slot value. `themeCss` must only emit values that passed `validateValue`.

## Overlay (`src/lib/overlay.ts`, Blob)

- `site/overlay/<sha256-hex-16>.json`: an immutable full overlay (`Overlay`). `site/overlay/head.json`: `{ current: string | null; history: Array<{ hash: string; at: string; summary: string; by: string }> }`, newest first, capped at 200. `by` is `"editor"`, `"studio:<runId>"`, `"revert"`, or `"bake"`.
- `overlayStore(env = process.env, blob = defaultBlobClient)` returns `{ read(): Promise<{ overlay: Overlay; head: Head }>; publish(patch: Record<string, unknown | null>, meta: { summary: string; by: string }): Promise<{ hash: string; overlay: Overlay; previous: string | null }>; revert(hash: string, meta?): Promise<{ hash: string; previous: string | null }>; prune(): Promise<string[]> }`.
  - `publish` merges the patch into the current overlay (`null` removes the entry, i.e. back to the default), validates every patched entry with `validateValue` (any failure rejects the whole publish with a `OverlayError` listing slot errors), uploads the version file, then writes `head.json` conditional on the ETag read at the start (`ifMatch`). A lost race throws `OverlayConflict`; nothing is live until the head write succeeds.
  - `revert` points `current` at an existing history hash (verifying the file exists) and prepends a history entry.
  - `prune` drops overlay entries equal to the code default (how a bake finishes) and publishes the result with `by: "bake"` if anything changed.
  - Follow the injected-deps pattern of `src/lib/sync.ts` / `src/lib/posts.ts` (`blobEnabled`, `readBlob`) so tests run against an in-memory fake.
- Reading for render: `readPublishedOverlay()` reads the head from origin (not the CDN) like the posts index. No Blob token → `{}`. A Blob read error throws (the build fails or ISR keeps the previous page); a missing head is `{}`.
- Routes (all writes call `requireOwner`):
  - `GET /api/overlay` → `{ overlay, history, defaults, slots }` (owner only; the editor boots from it).
  - `POST /api/overlay` body `{ patch, summary }` → `{ hash }`, then `revalidatePath("/", "layout")`.
  - `POST /api/overlay/revert` body `{ hash }` → `{ hash }`, then revalidate.
  - `POST /api/overlay/image` multipart `file` (+ `alt`) → strips EXIF with `src/lib/jpeg.ts`, uploads to `site/images/<hash>.jpg`, returns `{ url, width, height, alt }`. JPEG only for now, 8 MB cap.

## Auth and database

- Neon Postgres via `@neondatabase/serverless` + Drizzle. `src/db/schema.ts` holds every table; `src/db/index.ts` exports `dbEnabled(env)` and a lazy `getDb()`. Migrations: `drizzle-kit` (`bun run db:push`). Tests use `@electric-sql/pglite` with the same schema; data functions take the db as a parameter.
- Better Auth (`src/lib/auth.ts`), GitHub sign-in only, Drizzle adapter, mounted at `/api/auth/[...all]`. Env: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `OWNER_GITHUB_ID` (defaults to `856034`).
- `getOwner(headers: Headers): Promise<{ id: string; name: string; image?: string } | null>`: non-null only when the session's linked GitHub account id equals `OWNER_GITHUB_ID`. `requireOwner(request: Request): Promise<Owner>` throws a `Response` with status 401 otherwise. These two are the only auth API other code uses. When auth isn't configured both report no owner.
- Dev owner: when `NODE_ENV !== "production"` and `EDITOR_DEV_OWNER=1`, `getOwner` returns a fixed dev owner (so the UI can be built and tested without OAuth). Ignored in production builds; tested.
- `/sign-in`: a minimal page with "Continue with GitHub". After sign-in, `GET /api/me` → `{ owner: Owner | null }` and sets or clears the non-httpOnly hint cookie `editor=1` (the hint only decides whether to download the editor bundle; it grants nothing).
- Tables beyond Better Auth's (`user`, `session`, `account`, `verification`):
  - `threads(id text pk, title text, private bool default false, created_at, updated_at)`
  - `messages(id text pk, thread_id fk, role 'owner' | 'claude', body text, private bool default false, context jsonb null, run_id text null, created_at)`; `context` is `{ route?: string; slot?: string; selector?: string; text?: string }` from "Ask Claude about this".
  - `runs(id text pk, thread_id fk, message_id fk, lane 'fast' | 'code', status 'queued' | 'running' | 'done' | 'failed' | 'stopped' | 'needs_publish' | 'reverted', summary text null, result jsonb null, token_hash text null, stop_requested bool default false, heartbeat_at, started_at, ended_at)`; `result` is `{ overlayHash?, previousOverlayHash?, branch?, prNumber?, prUrl?, mergeSha?, revertSha?, previewUrl?, guarded?: string[], error?: string }`.
  - `run_steps(id serial pk, run_id fk, seq int, text text, state 'doing' | 'done' | 'failed', at)`: the public checklist.
  - `run_logs(id serial pk, run_id fk, seq int, text text, at)`: private (owner only).
- Ids are `crypto.randomUUID()` unless noted. A viewer who is not the owner never receives private threads, private messages, `context`, or `run_logs`.

## Studio (`/studio`)

- Data functions in `src/lib/studio/store.ts` (take `db`, `viewer: "owner" | "public"`): `listThreads`, `getThread(id, { afterMessage?, afterStep? })`, `createThread`, `postMessage`, `startRun`, `addStep`, `finishRun`, `requestStop`, `claimNextRun`. Caps enforced here: one non-terminal run at a time (a new request queues behind it), 30 code-lane runs per rolling 24 h.
- Routes: `GET /api/studio/threads`, `POST /api/studio/threads` `{ body, private?, context? }`, `GET /api/studio/threads/[id]` (polling; `?after=<iso>` returns only changes), `POST /api/studio/threads/[id]/messages`, `POST /api/studio/runs/[id]/stop`, `POST /api/studio/runs/[id]/revert`, `POST /api/studio/runs/[id]/publish` (approve a `needs_publish` run). Writes call `requireOwner`. Reads are public and filtered.
- Posting a message creates a run and executes the fast lane inside the request's lifetime with `after()` (`maxDuration = 300`).
- UI: `/studio` and `/studio/[thread]`, laid out like a chat app: thread list left, conversation right, composer for the owner only. A run renders as a card with a live checklist (poll every 1.5 s while a run is non-terminal, otherwise no polling), result line, links, and Stop / Revert / Publish buttons for the owner.

### Fast lane (`src/lib/studio/fast.ts`)

One Anthropic Messages tool loop (`@anthropic-ai/sdk`, model `process.env.STUDIO_FAST_MODEL ?? "claude-sonnet-5-5"`, key `ANTHROPIC_API_KEY`), client injected for tests. Tools: `read_slots` (registry + current values), `read_page({ path })` (the page's rendered text, fetched from the site's own origin; same-origin paths only), `publish_overlay({ patch, summary })` (through `overlayStore().publish`, `by: "studio:<runId>"`), `escalate_to_code({ brief })`. Each tool call adds a step. The system prompt says: change only what was asked, prefer the overlay, escalate when the request needs new markup, slots, pages, or behavior, and answer questions without changing anything.

### Code lane (`src/lib/studio/code.ts`, `scripts/studio-runner.ts`)

- `escalate_to_code` (or a follow-up in a thread whose last run was code-lane and still open) starts a Vercel Sandbox (`@vercel/sandbox`) with the repo cloned, runs `scripts/studio-runner.ts` detached. The runner drives the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, model `STUDIO_CODE_MODEL ?? "claude-opus-5-5"`), then runs `bun run typecheck`, `bun run lint`, `bun test`, `bun run build` (two fix attempts), and reports steps to `POST /api/studio/runner` with a per-run bearer token (only its hash is stored).
- The sandbox gets only `ANTHROPIC_API_KEY` and the per-run token. Never `GITHUB_TOKEN`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, or auth secrets.
- Finish (server side, `src/lib/studio/github.ts`, fetch injected): read the changed files out of the sandbox, commit them to `studio/<run short id>` through the GitHub API, open a PR, wait for the Vercel preview deployment on that commit to succeed, then squash-merge. If any changed path matches `GUARDED_PATHS` (auth, `src/lib/studio/**`, `scripts/studio-runner.ts`, `src/app/api/**`, the Notion sync, `vercel.json`, `next.config.ts`, `package.json`, `bun.lock`, `src/db/**`, this file's contracts) the run stops at `needs_publish` and waits for the owner's Publish.
- Revert: fast lane → `overlayStore().revert(previousOverlayHash)`; code lane → a revert PR of the merge commit, merged immediately.
- Every Sandbox and GitHub call has a time limit; a stale-run reaper fails runs whose heartbeat is older than 15 minutes (checked when threads are read, no cron needed).
- The agent's brief includes the current overlay so it sees real values, and may bake them: commit overlay values into `content.json`/`theme.json`, after which `prune()` drops the now-redundant entries.

## Editor bar (`src/editor/`)

- `src/components/editor-loader.tsx` ("use client", tiny) is the only editor code in the public bundle: on mount it checks `document.cookie` for `editor=1` and then `import("@/editor")`. Visitors never download the editor.
- The editor boots from `GET /api/overlay` (a 401 clears the hint cookie and unmounts). It keeps the draft (`Record<slotId, value | null>`) in `localStorage["site-draft"]` and applies it to the DOM: text via the `data-e` contract, tokens via CSS variables, order/visibility via `data-section`, lists via `data-e-list`.
- Features: click a text slot to edit in place (`contentEditable="plaintext-only"`, Enter commits unless multiline, Escape cancels); a side panel listing slots by `group` with the right control per kind (color picker, font select, range for length/number, list editor with add/remove/reorder, order editor with drag and hide toggles, image swap with upload); a bar with draft count, Publish, Discard, History (versions with Revert), "Ask Claude about this" (opens `/studio?ask=<encoded context>`), and Sign out.
- On post pages the body is not editable; the bar shows "Edit in Notion" linking the post's Notion URL.
- Client-side validation uses the same `validateValue`; the server validates again.

## Design language for editor and studio chrome

Quiet, editorial, and built from the site's own tokens so the chrome restyles with the theme: `var(--ink)`, `var(--link)` as the accent, `var(--muted)`, hairlines in `var(--line)`, panels in `var(--surface)`, Figtree (`var(--font-sans)`). UI text 13–14 px, 10 px radii, one soft elevation for floating chrome and no other shadows, 120–160 ms ease-out transitions that respect `prefers-reduced-motion`, visible focus rings, full keyboard operability, comfortable at 390 px wide. No emoji, no gradients, no icon library (inline SVG only). Copy is plain and short.
