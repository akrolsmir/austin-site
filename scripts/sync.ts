// Mirrors published Notion posts into data/posts-raw/<id>.json (block JSON, signed URLs replaced by Blob mirrors)
// and converts them to data/posts/<slug>.md. Only posts whose last-edited time changed are refetched.
// `bun run sync` does both; `bun run sync --offline` reconverts from the raw cache without touching Notion.
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { BlobNotFoundError, head, put } from "@vercel/blob";
import { createNotionClient } from "../src/lib/notion-client";
import { MEDIA, blocksToMarkdown } from "../src/lib/notion-markdown";
import { POSTS_DIR, serializePost, slugify } from "../src/lib/posts";
import type { Block, Post } from "../src/lib/types";

const RAW_DIR = join(process.cwd(), "data", "posts-raw");
type Raw = { page: Post; blocks: Block[] };
type FileBlock = { file?: { url: string; expiry_time?: string } };

function* mediaBlocks(blocks: Block[]): Generator<Block> {
  for (const block of blocks) {
    if (MEDIA.includes(block.type) && (block[block.type] as FileBlock)?.file?.url) yield block;
    if (block.children) yield* mediaBlocks(block.children);
  }
}
// Keys include the block's edit time, so a replaced image gets a new key and unchanged ones are skipped.
async function mirror(postId: string, block: Block): Promise<string> {
  const source = (block[block.type] as Required<FileBlock>).file.url;
  const stamp = String(block.last_edited_time ?? "").replace(/\D/g, "").slice(0, 14);
  const ext = extname(new URL(source).pathname).toLowerCase();
  const key = `posts/${postId}/${block.id.replaceAll("-", "")}-${stamp}${ext}`;
  try { return (await head(key)).url; } catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
  const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for block ${block.id}.`);
  const blob = await put(key, await response.arrayBuffer(), { access: "public", addRandomSuffix: false, contentType: response.headers.get("content-type") ?? undefined });
  console.log(`  uploaded ${key}`);
  return blob.url;
}
function readRaw(id: string): Raw | undefined {
  try { return JSON.parse(readFileSync(join(RAW_DIR, `${id}.json`), "utf8")); } catch { return undefined; }
}
function write(file: string, next: string) {
  let previous = "";
  try { previous = readFileSync(file, "utf8"); } catch {}
  if (previous === next) return false;
  writeFileSync(file, next);
  console.log(`  ${previous ? "updated" : "added"} ${file.slice(process.cwd().length + 1)}`);
  return true;
}
function prune(dir: string, ext: string, keep: Set<string>) {
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (name.endsWith(ext) && !keep.has(name.slice(0, -ext.length))) { unlinkSync(join(dir, name)); removed++; console.log(`  removed ${name}`); }
  }
  return removed;
}

async function main() {
  const offline = process.argv.includes("--offline");
  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(POSTS_DIR, { recursive: true });
  let raws: Raw[];
  let changed = 0;
  if (offline) {
    raws = readdirSync(RAW_DIR).filter((name) => name.endsWith(".json")).map((name) => readRaw(name.slice(0, -5))!);
  } else {
    const client = createNotionClient();
    const posts = await client.posts();
    console.log(`${posts.length} published posts`);
    raws = [];
    for (const page of posts) {
      const cached = readRaw(page.id);
      if (cached?.page.edited === page.edited) { raws.push(cached); continue; }
      const blocks = await client.blocks(page.id);
      for (const block of mediaBlocks(blocks)) {
        // Signed Notion URLs expire within an hour; the committed cache keeps only the Blob mirror.
        const file = (block[block.type] as Required<FileBlock>).file;
        file.url = await mirror(page.id, block);
        delete file.expiry_time;
      }
      const raw = { page, blocks };
      raws.push(raw);
      if (write(join(RAW_DIR, `${page.id}.json`), JSON.stringify(raw, null, 2) + "\n")) changed++;
    }
    changed += prune(RAW_DIR, ".json", new Set(posts.map((post) => post.id)));
  }
  raws.sort((a, b) => new Date(b.page.date).getTime() - new Date(a.page.date).getTime());
  const slugs = new Set<string>();
  for (const { page, blocks } of raws) {
    let slug = slugify(page.title);
    if (slugs.has(slug)) slug = `${slug}-${page.id.slice(0, 6)}`;
    slugs.add(slug);
    const body = blocksToMarkdown(blocks, { sourceUrl: page.url });
    if (write(join(POSTS_DIR, `${slug}.md`), serializePost({ title: page.title, date: page.date, notion: page.id, url: page.url, excerpt: page.excerpt, body }))) changed++;
  }
  changed += prune(POSTS_DIR, ".md", slugs);
  console.log(changed ? `${changed} file(s) changed` : "no changes");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
