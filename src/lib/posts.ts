import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { cache } from "react";
import { get, list } from "@vercel/blob";

export const POSTS_DIR = join(process.cwd(), "data", "posts");
export const INDEX_PATH = "site/index.json";
export type PostMeta = { slug: string; title: string; date: string; notion: string; url: string; excerpt: string };
export type PostFile = PostMeta & { body: string };
// The Blob index lists every live post with content-addressed keys for its raw cache (site/raw/<raw>.json) and markdown
// (site/posts/<markdown>.md). Those files are immutable, so writing the index is the single commit point of a sync.
export type IndexEntry = PostMeta & { edited: string; raw: string; markdown: string };
export type PostIndex = { build?: string; syncedAt?: string; posts: IndexEntry[] };
type BlobRead = { statusCode: number; stream: ReadableStream<Uint8Array> | null; blob: { etag: string } } | null;
export type BlobGet = (pathname: string, options: { access: "public"; abortSignal?: AbortSignal }) => Promise<BlobRead>;
export type BlobList = (options: { prefix: string; cursor?: string; abortSignal?: AbortSignal }) => Promise<{ blobs: Array<{ pathname: string; url: string; uploadedAt: Date }>; cursor?: string; hasMore: boolean }>;
export type BlobReads = { get: BlobGet; list: BlobList };
type BlobPut = (pathname: string, body: string, options: { access: "public"; addRandomSuffix: false; allowOverwrite: false; contentType: string }) => Promise<unknown>;
export const blobReads: BlobReads = { get, list: (options) => list(options) };
const FIELDS = ["title", "date", "notion", "url", "excerpt"] as const;
const byDate = (a: { date: string }, b: { date: string }) => new Date(b.date).getTime() - new Date(a.date).getTime();

export function slugify(title: string) {
  return title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "") || "untitled";
}
// Frontmatter values are JSON strings, which are valid YAML scalars and round-trip any title.
export function serializePost(post: Omit<PostFile, "slug">) {
  return `---\n${FIELDS.map((key) => `${key}: ${JSON.stringify(post[key])}`).join("\n")}\n---\n\n${post.body}`;
}
export function parsePost(slug: string, raw: string): PostFile {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) throw new Error(`Post ${slug} is missing frontmatter.`);
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const [, key, value] = line.match(/^(\w+): (.*)$/) ?? [];
    if (key) meta[key] = JSON.parse(value);
  }
  for (const key of FIELDS) if (typeof meta[key] !== "string") throw new Error(`Post ${slug} is missing ${key}.`);
  return { slug, title: meta.title, date: meta.date, notion: meta.notion, url: meta.url, excerpt: meta.excerpt, body: raw.slice(match[0].length).trim() };
}
export function readPosts(dir = POSTS_DIR): PostFile[] {
  let files: string[] = [];
  try { files = readdirSync(dir).filter((name) => name.endsWith(".md")); } catch { return []; }
  return files.map((name) => parsePost(name.slice(0, -3), readFileSync(join(dir, name), "utf8"))).sort(byDate);
}

// Blob is the live store whenever a token is configured (POSTS_SOURCE=local forces the committed snapshot, e.g. to preview
// converter changes). Without a token, or before the store is seeded, posts come from the committed data/posts.
export const blobEnabled = (env: Record<string, string | undefined>) => Boolean(env.BLOB_READ_WRITE_TOKEN) && env.POSTS_SOURCE !== "local";
const READ_MS = 8000;
export async function readBlob(blobGet: BlobGet, pathname: string) {
  const result = await blobGet(pathname, { access: "public", abortSignal: AbortSignal.timeout(READ_MS) });
  if (!result) return null;
  if (result.statusCode !== 200 || !result.stream) throw new Error(`Blob read failed for ${pathname}.`);
  return { text: await new Response(result.stream).text(), etag: result.blob.etag };
}

// Commit pointers (the post index, the overlay head). A public blob is always served through the CDN (get()'s
// `useCache: false` only applies to private stores), and an overwritten file can be served stale for a minute, so a pointer
// that is overwritten in place cannot be read back reliably right after a commit. Instead every commit is a new file that
// is never overwritten, `<prefix><12-digit seq>-<tag>.json`: creating seq n+1 without allowOverwrite is the compare-and-swap,
// and the newest one is found with list(), which asks the Blob API rather than the CDN. The tag is derived from the Blob
// token, so the next pointer's URL cannot be guessed (and requested before it exists) by anyone without the token.
export const POINTERS_KEPT = 20;
const POINTER = /^(\d{12})-[0-9a-f]{16}\.json$/;
export class PointerConflict extends Error { constructor() { super("Another commit got there first."); this.name = "PointerConflict"; } }
export const pointerPath = (prefix: string, seq: number, secret: string) => `${prefix}${String(seq).padStart(12, "0")}-${createHash("sha256").update(`${secret}\n${prefix}\n${seq}`).digest("hex").slice(0, 16)}.json`;
/** The newest commit under `prefix` (null before the first), with the URLs of all but the newest POINTERS_KEPT for cleanup. */
export async function readPointer({ get: blobGet, list: blobList }: BlobReads, prefix: string): Promise<{ seq: number; text: string; older: string[] } | null> {
  const found: Array<{ seq: number; pathname: string; url: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await blobList({ prefix, cursor, abortSignal: AbortSignal.timeout(READ_MS) });
    for (const blob of page.blobs) { const seq = blob.pathname.startsWith(prefix) ? POINTER.exec(blob.pathname.slice(prefix.length))?.[1] : undefined; if (seq) found.push({ seq: Number(seq), pathname: blob.pathname, url: blob.url }); }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  if (!found.length) return null;
  found.sort((a, b) => b.seq - a.seq);
  const file = await readBlob(blobGet, found[0].pathname);
  if (!file) throw new Error(`Blob read failed for ${found[0].pathname}.`);
  return { seq: found[0].seq, text: file.text, older: found.slice(POINTERS_KEPT).map((blob) => blob.url) };
}
/** Commits `text` as pointer number `seq`. Throws PointerConflict when that number (or a later one) is already taken by someone else. */
export async function writePointer(blob: BlobReads & { put: BlobPut }, prefix: string, seq: number, text: string, secret: string): Promise<void> {
  try { await blob.put(pointerPath(prefix, seq, secret), text, { access: "public", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" }); }
  catch (error) {
    // Blob has no distinct error for "already exists", so look at who holds this number now (it may even be this write).
    const now = await readPointer(blob, prefix).catch(() => undefined);
    if (now && now.seq === seq && now.text === text) return;
    if (now && now.seq >= seq) throw new PointerConflict();
    throw error;
  }
}
export function parseIndex(text: string): PostIndex {
  const index = JSON.parse(text);
  if (!Array.isArray(index?.posts) || index.posts.some((post: IndexEntry) => !post.slug || !post.markdown || !post.raw)) throw new Error("Blob post index is malformed.");
  return index;
}
export const INDEX_PREFIX = "site/index/";
/** The live post index: the newest pointer under site/index/, else the single site/index.json that earlier deployments wrote. */
export async function readIndex(blob: BlobReads): Promise<{ index: PostIndex; seq: number; older: string[] } | null> {
  const found = await readPointer(blob, INDEX_PREFIX);
  if (found) return { index: parseIndex(found.text), seq: found.seq, older: found.older };
  const legacy = await readBlob(blob.get, INDEX_PATH);
  return legacy ? { index: parseIndex(legacy.text), seq: 0, older: [] } : null;
}
const meta = ({ slug, title, date, notion, url, excerpt }: PostMeta): PostMeta => ({ slug, title, date, notion, url, excerpt });

export function postSource(env: Record<string, string | undefined> = process.env, blob: BlobReads = blobReads, dir = POSTS_DIR) {
  let local: PostFile[] | undefined, warned = false;
  const snapshot = () => (local ??= readPosts(dir));
  const bodies = new Map<string, Promise<PostFile>>(); // keyed by content hash, so safe to keep for the process lifetime
  // The index is found through the Blob API (readPointer), so a render right after a sync sees it. Read errors throw,
  // which fails the build or keeps the previously rendered ISR page; only a missing index falls back to the snapshot.
  async function index() {
    if (!blobEnabled(env)) return undefined;
    const found = await readIndex(blob);
    if (!found && !warned) { warned = true; console.warn("Blob post index not found; serving committed data/posts."); }
    return found?.index;
  }
  return {
    async posts(): Promise<PostMeta[]> {
      const live = await index();
      return live ? live.posts.map(meta).sort(byDate) : snapshot().map(meta);
    },
    async post(slug: string): Promise<PostFile | null> {
      const live = await index();
      if (!live) return snapshot().find((post) => post.slug === slug) ?? null;
      const entry = live.posts.find((post) => post.slug === slug);
      if (!entry) return null;
      let body = bodies.get(entry.markdown);
      if (!body) {
        body = readBlob(blob.get, `site/posts/${entry.markdown}.md`).then((found) => { if (!found) throw new Error(`Blob markdown for ${slug} is missing.`); return parsePost(slug, found.text); });
        bodies.set(entry.markdown, body);
        body.catch(() => bodies.delete(entry.markdown));
      }
      return body;
    },
  };
}
// "Nov 20, 2026"; dates are calendar days, so format in UTC to avoid shifting a day.
export function formatDate(date: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(date)); }
let source: ReturnType<typeof postSource> | undefined;
export const getPosts = cache(() => (source ??= postSource()).posts());
export const getPost = cache((slug: string) => (source ??= postSource()).post(slug));
