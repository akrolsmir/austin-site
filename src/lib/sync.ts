// One sync core shared by `bun run sync` (scripts/sync.ts) and /api/sync. It queries Notion's publish-filtered index,
// refetches only pages whose last-edited time changed, mirrors Notion-hosted media to Blob, measures images, converts to
// markdown, and stages every file in the store. Nothing becomes visible until store.commit, which runs only after all of
// that succeeded; any throw before it leaves the live site untouched.
import { createHash, timingSafeEqual } from "node:crypto";
import { readdirSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { BlobNotFoundError, del, get, head, list, put } from "@vercel/blob";
import { imageSize } from "image-size";
import { createNotionClient } from "./notion-client";
import { MEDIA, blocksToMarkdown } from "./notion-markdown";
import { INDEX_PATH, POSTS_DIR, parseIndex, parsePost, readBlob, serializePost, slugify, type BlobGet, type IndexEntry, type PostIndex } from "./posts";
import type { Block, Post } from "./types";

export const RAW_DIR = join(process.cwd(), "data", "posts-raw");
export type Raw = { page: Post; blocks: Block[] };
export type Source = { posts(): Promise<Post[]>; blocks(id: string): Promise<Block[]> };
// Stores stage writes by content key and persist them only in commit, which returns whether any post changed.
export type Store = {
  load(): Promise<PostIndex | undefined>;
  readRaw(entry: IndexEntry): Promise<Raw>;
  writeRaw(key: string, id: string, text: string): void;
  writeMarkdown(key: string, slug: string, text: string): void;
  commit(next: PostIndex, previous: PostIndex | undefined): Promise<boolean>;
};
export type SyncResult = { posts: number; changed: string[]; removed: string[]; pending: number; committed: boolean };
type FileBlock = { file?: { url: string; expiry_time?: string } };
type ImageSource = { url: string; width?: number; height?: number };
const log = (line: string) => console.log(line);
const key = (name: string, text: string) => `${name}-${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
const byDate = (a: Post, b: Post) => new Date(b.date).getTime() - new Date(a.date).getTime();
const rawText = (raw: Raw) => JSON.stringify(raw, null, 2) + "\n";
const asPost = (entry: IndexEntry): Post => ({ id: entry.notion, title: entry.title, date: entry.date, edited: entry.edited, url: entry.url, excerpt: entry.excerpt });

export function* mediaBlocks(blocks: Block[]): Generator<Block> {
  for (const block of blocks) {
    if (MEDIA.includes(block.type) && (block[block.type] as FileBlock)?.file?.url) yield block;
    if (block.children) yield* mediaBlocks(block.children);
  }
}
// Keys include the block's edit time, so a replaced file gets a new key and unchanged ones are skipped. Sources already
// on Blob (e.g. replayed from the local raw cache) are kept as they are.
export async function mirrorMedia(postId: string, block: Block): Promise<string> {
  const source = (block[block.type] as Required<FileBlock>).file.url;
  if (new URL(source).hostname.endsWith(".blob.vercel-storage.com")) return source;
  const stamp = String(block.last_edited_time ?? "").replace(/\D/g, "").slice(0, 14);
  const ext = extname(new URL(source).pathname).toLowerCase();
  const pathname = `posts/${postId}/${block.id.replaceAll("-", "")}-${stamp}${ext}`;
  try { return (await head(pathname)).url; } catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
  const response = await fetch(source, { cache: "no-store", signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for block ${block.id}.`);
  const blob = await put(pathname, await response.arrayBuffer(), { access: "public", addRandomSuffix: false, contentType: response.headers.get("content-type") ?? undefined });
  log(`  uploaded ${pathname}`);
  return blob.url;
}
// Records intrinsic width/height on image sources that lack them so the site can render them with next/image.
// A source that cannot be fetched or decoded is left unmeasured (it renders as a plain <img>) rather than failing the sync.
export async function measureImages(blocks: Block[]): Promise<boolean> {
  let changed = false;
  for (const block of blocks) {
    if (block.children) changed = (await measureImages(block.children)) || changed;
    if (block.type !== "image") continue;
    const data = block.image as { file?: ImageSource; external?: ImageSource } | undefined;
    const source = data?.file ?? data?.external;
    if (!source?.url || (source.width && source.height)) continue;
    try {
      const response = await fetch(source.url, { cache: "no-store", signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const { width, height } = imageSize(new Uint8Array(await response.arrayBuffer()));
      if (!width || !height) throw new Error("no dimensions");
      Object.assign(source, { width, height });
      changed = true;
    } catch (error) { console.warn(`  could not measure ${source.url} for block ${block.id}: ${error instanceof Error ? error.message : error}`); }
  }
  return changed;
}

type SyncOptions = { store: Store; source: Source; build?: string; deadline?: number; requireIndex?: boolean; mirror?: typeof mirrorMedia; measure?: typeof measureImages };
// `build` identifies the converter; when it differs from the stored index (or is absent, as for the local mirror), every
// post is reconverted from its cached raw. After `deadline`, remaining changed pages keep their previous version (new
// pages wait) and are reported as pending; the commit is still consistent and the next run picks them up.
// `requireIndex` (used by /api/sync) refuses a cold sync: it takes ~10 minutes, longer than a function may run, and
// committing after the deadline would publish only part of the archive. Seed with `bun run sync --blob` instead.
export async function syncPosts({ store, source, build, deadline = Infinity, requireIndex = false, mirror = mirrorMedia, measure = measureImages }: SyncOptions): Promise<SyncResult> {
  const previous = await store.load();
  if (requireIndex && !previous) throw new Error("Blob store is not seeded; run `bun run sync --blob` first.");
  const before = new Map(previous?.posts.map((entry) => [entry.notion, entry]));
  const fresh = !build || previous?.build !== build;
  const pages = [...await source.posts()].sort(byDate);
  log(`${pages.length} published posts`);
  const posts: IndexEntry[] = [];
  const slugs = new Set<string>();
  let pending = 0;
  for (const page of pages) {
    const old = before.get(page.id);
    let current = page, raw: Raw | undefined, dirty = false;
    if (old?.edited !== page.edited) {
      if (Date.now() > deadline) { pending++; if (!old) continue; current = asPost(old); }
      else {
        raw = { page, blocks: await source.blocks(page.id) };
        for (const block of mediaBlocks(raw.blocks)) {
          // Signed Notion URLs expire within an hour; the cache keeps only the Blob mirror.
          const file = (block[block.type] as Required<FileBlock>).file;
          file.url = await mirror(page.id, block);
          delete file.expiry_time;
        }
        dirty = true;
      }
    }
    let slug = slugify(current.title);
    if (slugs.has(slug)) slug = `${slug}-${current.id.slice(0, 6)}`;
    slugs.add(slug);
    const meta = { slug, title: current.title, date: current.date, notion: current.id, url: current.url, excerpt: current.excerpt };
    if (old && !raw && !fresh && (Object.keys(meta) as (keyof typeof meta)[]).every((field) => old[field] === meta[field])) { posts.push(old); continue; }
    if (!raw) {
      const cached = await store.readRaw(old!);
      raw = { page: current === page ? page : cached.page, blocks: cached.blocks };
      dirty = JSON.stringify(raw.page) !== JSON.stringify(cached.page);
    }
    dirty = (await measure(raw.blocks)) || dirty;
    const text = rawText(raw), markdown = serializePost({ ...meta, body: blocksToMarkdown(raw.blocks, { sourceUrl: current.url }) });
    const entry: IndexEntry = { ...meta, edited: raw.page.edited, raw: dirty || !old ? key(page.id, text) : old.raw, markdown: key(slug, markdown) };
    if (entry.raw !== old?.raw) store.writeRaw(entry.raw, page.id, text);
    store.writeMarkdown(entry.markdown, slug, markdown);
    posts.push(entry);
  }
  const next: PostIndex = { ...(build ? { build } : {}), syncedAt: new Date().toISOString(), posts };
  const prior = new Map(previous?.posts.map((entry) => [entry.slug, entry.markdown]));
  const changed = posts.filter((entry) => prior.get(entry.slug) !== entry.markdown).map((entry) => entry.slug);
  const removed = [...prior.keys()].filter((slug) => !slugs.has(slug));
  const committed = await store.commit(next, previous);
  log(committed ? `${changed.length} changed, ${removed.length} removed${pending ? `, ${pending} pending` : ""}` : "no changes");
  return { posts: posts.length, changed: committed ? changed : [], removed: committed ? removed : [], pending, committed };
}

// Replays the local raw cache as if it were Notion (offline reconversion and pushing the snapshot to Blob).
export function localSource(dir = RAW_DIR): Source {
  const raws = new Map(listFiles(dir, ".json").map((name) => { const raw: Raw = JSON.parse(readFileSync(join(dir, name), "utf8")); return [raw.page.id, raw]; }));
  return { posts: async () => [...raws.values()].map((raw) => raw.page), blocks: async (id) => structuredClone(raws.get(id)!.blocks) };
}
function listFiles(dir: string, ext: string) { try { return readdirSync(dir).filter((name) => name.endsWith(ext)); } catch { return []; } }

// The committed git snapshot: data/posts-raw/<id>.json and data/posts/<slug>.md. It never records a build, so every run
// reconverts everything, and commit writes only files whose bytes changed.
export function fsStore(rawDir = RAW_DIR, postsDir = POSTS_DIR): Store {
  const raws = new Map<string, string>(), markdown = new Map<string, string>();
  const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8");
  return {
    async load() {
      const files = new Map(listFiles(postsDir, ".md").map((name) => { const text = read(postsDir, name), slug = name.slice(0, -3); return [parsePost(slug, text).notion, { slug, text }]; }));
      const posts = listFiles(rawDir, ".json").map((name): IndexEntry => {
        const text = read(rawDir, name), raw: Raw = JSON.parse(text), md = files.get(raw.page.id);
        return { slug: md?.slug ?? "", title: raw.page.title, date: raw.page.date, notion: raw.page.id, url: raw.page.url, excerpt: raw.page.excerpt, edited: raw.page.edited, raw: key(raw.page.id, text), markdown: md ? key(md.slug, md.text) : "" };
      });
      return { posts };
    },
    async readRaw(entry) { return JSON.parse(read(rawDir, `${entry.notion}.json`)); },
    writeRaw(_key, id, text) { raws.set(id, text); },
    writeMarkdown(_key, slug, text) { markdown.set(slug, text); },
    async commit(next) {
      mkdirSync(rawDir, { recursive: true });
      mkdirSync(postsDir, { recursive: true });
      let changed = 0;
      const write = (dir: string, name: string, text: string) => {
        let previous = "";
        try { previous = read(dir, name); } catch {}
        if (previous !== text) { writeFileSync(join(dir, name), text); changed++; log(`  ${previous ? "updated" : "added"} ${join(dir, name).slice(process.cwd().length + 1)}`); }
      };
      const prune = (dir: string, ext: string, keep: Set<string>) => {
        for (const name of listFiles(dir, ext)) if (!keep.has(name.slice(0, -ext.length))) { unlinkSync(join(dir, name)); changed++; log(`  removed ${name}`); }
      };
      for (const [id, text] of raws) write(rawDir, `${id}.json`, text);
      for (const [slug, text] of markdown) write(postsDir, `${slug}.md`, text);
      prune(rawDir, ".json", new Set(next.posts.map((post) => post.notion)));
      prune(postsDir, ".md", new Set(next.posts.map((post) => post.slug)));
      return changed > 0;
    },
  };
}

export type BlobApi = { get: BlobGet; head: (pathname: string) => Promise<{ etag: string }>; put: typeof put; list: typeof list; del: typeof del };
const blobApi: BlobApi = { get, head, put, list, del };
// The live store. Raw and markdown files are content-addressed (site/raw/<id>-<hash>.json, site/posts/<slug>-<hash>.md),
// so uploading them changes nothing visible; site/index.json is written last, conditional on the ETag read at load, so a
// concurrent sync fails instead of overwriting. Every successful sync rewrites the index, even with no post changes, to
// record syncedAt for the /api/sync cooldown. Files no index references are deleted a day later, best effort.
export function blobStore(api: BlobApi = blobApi, now = Date.now): Store {
  const staged = new Map<string, string>();
  let etag: string | undefined;
  return {
    // The ETag comes from head(), not get(): content reads may be compressed and carry a weak ETag (W/"…"), which never
    // satisfies ifMatch. Reading head first means a change in between makes the commit fail rather than overwrite.
    async load() {
      try { etag = (await api.head(INDEX_PATH)).etag; } catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; etag = undefined; }
      const found = etag ? await readBlob(api.get, INDEX_PATH, false) : null;
      return found ? parseIndex(found.text) : undefined;
    },
    async readRaw(entry) {
      const found = await readBlob(api.get, `site/raw/${entry.raw}.json`);
      if (!found) throw new Error(`Blob raw cache for ${entry.notion} is missing.`);
      return JSON.parse(found.text);
    },
    writeRaw(key, _id, text) { staged.set(`site/raw/${key}.json`, text); },
    writeMarkdown(key, _slug, text) { staged.set(`site/posts/${key}.md`, text); },
    async commit(next, previous) {
      const known = new Set(previous?.posts.flatMap((post) => [`site/raw/${post.raw}.json`, `site/posts/${post.markdown}.md`]));
      const uploads = [...staged].filter(([pathname]) => !known.has(pathname));
      const content = (index?: PostIndex) => JSON.stringify({ ...index, syncedAt: undefined });
      const changed = uploads.length > 0 || content(next) !== content(previous);
      for (let i = 0; i < uploads.length; i += 8) {
        await Promise.all(uploads.slice(i, i + 8).map(([pathname, text]) => api.put(pathname, text, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: pathname.endsWith(".md") ? "text/markdown; charset=utf-8" : "application/json" })));
      }
      await api.put(INDEX_PATH, JSON.stringify(next), { access: "public", addRandomSuffix: false, allowOverwrite: Boolean(etag), ifMatch: etag, contentType: "application/json", cacheControlMaxAge: 60 });
      log(`  uploaded ${uploads.length} file(s) and ${INDEX_PATH}`);
      if (!changed) return false;
      try {
        const live = new Set([INDEX_PATH, ...next.posts.flatMap((post) => [`site/raw/${post.raw}.json`, `site/posts/${post.markdown}.md`])]);
        const stale: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await api.list({ prefix: "site/", cursor });
          for (const blob of page.blobs) if (!live.has(blob.pathname) && now() - new Date(blob.uploadedAt).getTime() > 86400000) stale.push(blob.url);
          cursor = page.hasMore ? page.cursor : undefined;
        } while (cursor);
        if (stale.length) { await api.del(stale); log(`  deleted ${stale.length} unreferenced file(s)`); }
      } catch (error) { console.warn(`  cleanup skipped: ${error instanceof Error ? error.message : error}`); }
      return true;
    },
  };
}

// /api/sync is open: anyone (including a plain Notion "Send webhook" button) can trigger a sync, since a sync can only
// publish what Notion already marks published. To keep a request loop from exhausting the Notion rate limit, a call
// without `Authorization: Bearer $CRON_SECRET` (which Vercel Cron sends) is skipped while the index's syncedAt is under
// COOLDOWN old. A CRON_SECRET shorter than 16 characters never matches; comparison hashes both sides (constant-time).
export const COOLDOWN = 60000;
const digest = (value: string) => createHash("sha256").update(value).digest();
export function authorized(request: Request, env: Record<string, string | undefined>) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  return Boolean(bearer && env.CRON_SECRET && env.CRON_SECRET.length >= 16 && timingSafeEqual(digest(bearer), digest(env.CRON_SECRET)));
}
export async function lastSynced(api: Pick<BlobApi, "get"> = blobApi) {
  const found = await readBlob(api.get, INDEX_PATH, false);
  const at = found ? Date.parse(parseIndex(found.text).syncedAt ?? "") : NaN;
  return Number.isFinite(at) ? at : undefined;
}
type HandlerDeps = { env?: Record<string, string | undefined>; run: (deadline: number) => Promise<SyncResult>; lastSync: () => Promise<number | undefined>; revalidate: (path: string, type?: "layout" | "page") => void; now?: () => number };
export function syncHandler({ env = process.env, run, lastSync, revalidate, now = Date.now }: HandlerDeps) {
  return async function handle(request: Request) {
    const headers = { "Cache-Control": "no-store" };
    let result: SyncResult;
    try {
      if (!authorized(request, env)) {
        const last = await lastSync();
        if (last !== undefined && now() - last < COOLDOWN) return Response.json({ skipped: "cooldown", retryAfter: Math.ceil((COOLDOWN - (now() - last)) / 1000) }, { headers });
      }
      result = await run(now() + 180000);
    } catch (error) {
      // Sync errors are written without response bodies or tokens; the client only learns that it failed.
      console.error(`sync failed: ${error instanceof Error ? error.message : "unknown error"}`);
      return Response.json({ error: "Sync failed; nothing was published." }, { status: 500, headers });
    }
    // Any change revalidates the whole site from the root layout: per-path revalidatePath("/") left the homepage's
    // prerender cached on Vercel, and every page (home, /posts, each post) lists or renders posts anyway.
    const revalidated = result.changed.length > 0 || result.removed.length > 0;
    if (revalidated) revalidate("/", "layout");
    return Response.json({ ...result, revalidated }, { headers });
  };
}
export function runSync(env: Record<string, string | undefined> = process.env, deadline?: number) {
  if (!env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is missing.");
  return syncPosts({ store: blobStore(), source: createNotionClient(env), build: env.VERCEL_GIT_COMMIT_SHA || env.VERCEL_DEPLOYMENT_ID || "unknown", deadline, requireIndex: true });
}
