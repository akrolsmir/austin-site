import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cache } from "react";
import { get } from "@vercel/blob";

export const POSTS_DIR = join(process.cwd(), "data", "posts");
export const INDEX_PATH = "site/index.json";
export type PostMeta = { slug: string; title: string; date: string; notion: string; url: string; excerpt: string };
export type PostFile = PostMeta & { body: string };
// The Blob index lists every live post with content-addressed keys for its raw cache (site/raw/<raw>.json) and markdown
// (site/posts/<markdown>.md). Those files are immutable, so writing the index is the single commit point of a sync.
export type IndexEntry = PostMeta & { edited: string; raw: string; markdown: string };
export type PostIndex = { build?: string; posts: IndexEntry[] };
type BlobRead = { statusCode: number; stream: ReadableStream<Uint8Array> | null; blob: { etag: string } } | null;
export type BlobGet = (pathname: string, options: { access: "public"; useCache?: boolean }) => Promise<BlobRead>;
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
export async function readBlob(blobGet: BlobGet, pathname: string, useCache = true) {
  const result = await blobGet(pathname, { access: "public", useCache });
  if (!result) return null;
  if (result.statusCode !== 200 || !result.stream) throw new Error(`Blob read failed for ${pathname}.`);
  return { text: await new Response(result.stream).text(), etag: result.blob.etag };
}
export function parseIndex(text: string): PostIndex {
  const index = JSON.parse(text);
  if (!Array.isArray(index?.posts) || index.posts.some((post: IndexEntry) => !post.slug || !post.markdown || !post.raw)) throw new Error("Blob post index is malformed.");
  return index;
}
const meta = ({ slug, title, date, notion, url, excerpt }: PostMeta): PostMeta => ({ slug, title, date, notion, url, excerpt });

export function postSource(env: Record<string, string | undefined> = process.env, blobGet: BlobGet = get, dir = POSTS_DIR) {
  let local: PostFile[] | undefined, warned = false;
  const snapshot = () => (local ??= readPosts(dir));
  const bodies = new Map<string, Promise<PostFile>>(); // keyed by content hash, so safe to keep for the process lifetime
  // The index is read from origin (bypassing the CDN) so a render right after a sync sees it. Read errors throw, which
  // fails the build or keeps the previously rendered ISR page; only a missing index falls back to the snapshot.
  async function index() {
    if (!blobEnabled(env)) return undefined;
    const found = await readBlob(blobGet, INDEX_PATH, false);
    if (!found && !warned) { warned = true; console.warn("Blob post index not found; serving committed data/posts."); }
    return found ? parseIndex(found.text) : undefined;
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
        body = readBlob(blobGet, `site/posts/${entry.markdown}.md`).then((found) => { if (!found) throw new Error(`Blob markdown for ${slug} is missing.`); return parsePost(slug, found.text); });
        bodies.set(entry.markdown, body);
        body.catch(() => bodies.delete(entry.markdown));
      }
      return body;
    },
  };
}
let source: ReturnType<typeof postSource> | undefined;
export const getPosts = cache(() => (source ??= postSource()).posts());
export const getPost = cache((slug: string) => (source ??= postSource()).post(slug));
