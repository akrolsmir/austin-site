import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INDEX_PATH, postSource, serializePost } from "../src/lib/posts";
import { authorized, blobStore, lastSynced, syncHandler, syncPosts, type BlobApi, type Source, type SyncResult } from "../src/lib/sync";
import type { Post } from "../src/lib/types";

const CRON = "cron-secret-0123456789";
const request = (headers: Record<string, string> = {}) => new Request("https://austin.site/api/sync", { method: "POST", headers });

// In-memory stand-in for @vercel/blob that enforces allowOverwrite and ifMatch like the real service.
function fakeBlob() {
  const files = new Map<string, { text: string; etag: string; uploadedAt: Date }>();
  const puts: string[] = [];
  let version = 0, failPut: string | undefined;
  const api = {
    async get(pathname: string) { const file = files.get(pathname); return file ? { statusCode: 200, stream: new Response(file.text).body, blob: { etag: file.etag } } : null; },
    async put(pathname: string, text: string, options: { allowOverwrite?: boolean; ifMatch?: string }) {
      if (failPut && pathname.startsWith(failPut)) throw new Error("upload failed");
      const existing = files.get(pathname);
      if (existing && !options.allowOverwrite) throw new Error("blob already exists");
      if (options.ifMatch && existing?.etag !== options.ifMatch) throw new Error("precondition failed");
      files.set(pathname, { text, etag: `e${++version}`, uploadedAt: new Date() });
      puts.push(pathname);
      return { url: `https://store.public.blob.vercel-storage.com/${pathname}`, pathname };
    },
    async list() { return { blobs: [...files].map(([pathname, file]) => ({ pathname, url: pathname, uploadedAt: file.uploadedAt })), hasMore: false }; },
    async del(urls: string[]) { for (const url of urls) files.delete(url); },
  };
  return { api: api as unknown as BlobApi, files, puts, failNext(prefix: string) { failPut = prefix; } };
}
const page = (id: string, title: string, edited = "2026-01-01T00:00:00.000Z", date = "2025-01-01"): Post => ({ id, title, date, edited, url: `https://notion.so/${id}`, excerpt: "" });
function source(pages: Post[], fail?: string): Source & { fetched: string[] } {
  const fetched: string[] = [];
  return { fetched, posts: async () => pages, blocks: async (id) => { if (id === fail) throw new Error("Notion request failed (500)."); fetched.push(id); return [{ id: `b-${id}`, type: "paragraph", paragraph: { rich_text: [{ plain_text: `body of ${id}` }] } }]; } };
}
const stubs = { mirror: async () => "https://store.public.blob.vercel-storage.com/x.png", measure: async () => false };
const run = (blob: ReturnType<typeof fakeBlob>, src: Source, extra: { build?: string; deadline?: number } = {}) => syncPosts({ store: blobStore(blob.api), source: src, build: "b1", ...stubs, ...extra });

test("only a long-enough CRON_SECRET bearer counts as authorized", () => {
  assert.equal(authorized(request({ authorization: `Bearer ${CRON}` }), { CRON_SECRET: CRON }), true);
  assert.equal(authorized(request({ authorization: "Bearer short" }), { CRON_SECRET: "short" }), false);
  assert.equal(authorized(request({ authorization: `Bearer ${CRON}` }), {}), false);
  for (const bad of [request(), request({ authorization: `Bearer ${CRON}x` }), request({ authorization: CRON }), request({ "x-sync-secret": CRON })]) assert.equal(authorized(bad, { CRON_SECRET: CRON }), false);
});

test("handler: open calls respect the cooldown, cron always runs, failures hide details", async () => {
  const revalidated: string[] = [];
  let calls = 0, last: number | undefined = 1_000_000;
  const result: SyncResult = { posts: 2, changed: ["new-post"], removed: ["old-post"], pending: 0, committed: true };
  const deps = { run: async () => { calls++; return result; }, lastSync: async () => last, revalidate: (path: string) => { revalidated.push(path); } };
  const handle = syncHandler({ ...deps, env: { CRON_SECRET: CRON }, now: () => 1_000_000 + 30_000 });
  const skipped = await handle(request());
  assert.deepEqual([skipped.status, await skipped.json(), calls], [200, { skipped: "cooldown", retryAfter: 30 }, 0]);
  assert.equal((await handle(request({ authorization: "Bearer wrong" }))).status, 200);
  assert.equal(calls, 0);
  assert.equal((await handle(request({ authorization: `Bearer ${CRON}` }))).status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(revalidated, ["/", "/posts", "/posts/new-post", "/posts/old-post"]);
  // No CRON_SECRET configured: open calls still run once the cooldown has passed (or before any sync).
  const open = syncHandler({ ...deps, env: {}, now: () => 1_000_000 + 61_000 });
  assert.equal((await open(request())).status, 200);
  last = undefined;
  assert.equal((await open(request())).status, 200);
  assert.equal(calls, 3);

  const error = console.error;
  console.error = () => {};
  const failing = syncHandler({ ...deps, env: { CRON_SECRET: CRON }, run: async () => { throw new Error(`Notion request failed (401) ${CRON}`); } });
  const failed = await failing(request({ authorization: `Bearer ${CRON}` }));
  const unreadable = await syncHandler({ ...deps, env: {}, lastSync: async () => { throw new Error("blob down"); } })(request());
  console.error = error;
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), new RegExp(`${CRON}|Notion|401`));
  assert.deepEqual([unreadable.status, calls], [500, 3]);
  assert.equal(revalidated.length, 12);
});

test("each successful blob sync records syncedAt for the cooldown", async () => {
  const blob = fakeBlob();
  assert.equal(await lastSynced(blob.api), undefined);
  await run(blob, source([page("a", "Alpha")]));
  const first = await lastSynced(blob.api);
  assert.ok(first && Date.now() - first < 5000);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await run(blob, source([page("a", "Alpha")]))).committed, false);
  assert.ok((await lastSynced(blob.api))! > first);
});

test("blob sync is incremental and commits only through the index", async () => {
  const blob = fakeBlob();
  const first = await run(blob, source([page("a", "Alpha"), page("b", "Beta")]));
  assert.deepEqual([first.changed.sort(), first.removed, first.committed], [["alpha", "beta"], [], true]);
  assert.equal(blob.puts.at(-1), INDEX_PATH);
  const index = JSON.parse(blob.files.get(INDEX_PATH)!.text);
  assert.deepEqual(index.posts.map((post: { slug: string }) => post.slug).sort(), ["alpha", "beta"]);
  assert.match(blob.files.get(`site/posts/${index.posts[0].markdown}.md`)!.text, /body of/);

  blob.puts.length = 0;
  const unchanged = source([page("a", "Alpha"), page("b", "Beta")]);
  assert.deepEqual(await run(blob, unchanged), { posts: 2, changed: [], removed: [], pending: 0, committed: false });
  assert.deepEqual([unchanged.fetched, blob.puts], [[], [INDEX_PATH]]); // only syncedAt is rewritten
  blob.puts.length = 0;

  const edited = source([{ ...page("a", "Alpha", "2026-02-01T00:00:00.000Z"), excerpt: "now with an excerpt" }]);
  const next = await run(blob, edited);
  assert.deepEqual([edited.fetched, next.changed, next.removed], [["a"], ["alpha"], ["beta"]]);
  assert.equal(blob.puts.length, 3); // raw, markdown, index
  assert.equal(blob.puts.at(-1), INDEX_PATH);
});

test("a new converter build reconverts from the Blob raw cache without calling Notion", async () => {
  const blob = fakeBlob();
  await run(blob, source([page("a", "Alpha")]));
  const again = source([page("a", "Alpha")]);
  const result = await run(blob, again, { build: "b2" });
  assert.deepEqual([again.fetched, result.changed, result.committed], [[], [], true]);
  assert.equal(JSON.parse(blob.files.get(INDEX_PATH)!.text).build, "b2");
});

test("blob sync fails closed: a Notion or upload error leaves the live index untouched", async () => {
  const blob = fakeBlob();
  await run(blob, source([page("a", "Alpha")]));
  const before = blob.files.get(INDEX_PATH)!.text;
  blob.puts.length = 0;
  await assert.rejects(run(blob, source([page("a", "Alpha", "2026-03-01T00:00:00.000Z"), page("c", "Gamma")], "c")), /Notion request failed/);
  assert.deepEqual(blob.puts, []);
  blob.failNext("site/posts/");
  await assert.rejects(run(blob, source([page("c", "Gamma")])), /upload failed/);
  assert.equal(blob.files.get(INDEX_PATH)!.text, before);
});

test("a concurrent sync that committed first makes the slower one fail instead of overwriting", async () => {
  const blob = fakeBlob();
  await run(blob, source([page("a", "Alpha")]));
  const slow = blobStore(blob.api);
  const previous = await slow.load();
  await run(blob, source([page("b", "Beta")]));
  await assert.rejects(slow.commit({ posts: [] }, previous), /precondition failed/);
  assert.match(blob.files.get(INDEX_PATH)!.text, /beta/);
});

test("past the deadline, changed posts keep their previous version and new ones wait", async () => {
  const blob = fakeBlob();
  await run(blob, source([page("a", "Alpha")]));
  const late = source([page("a", "Alpha", "2026-04-01T00:00:00.000Z"), page("n", "New")]);
  const result = await run(blob, late, { deadline: 0 });
  assert.deepEqual([late.fetched, result.pending, result.changed], [[], 2, []]);
  assert.deepEqual(JSON.parse(blob.files.get(INDEX_PATH)!.text).posts.map((post: { edited: string }) => post.edited), ["2026-01-01T00:00:00.000Z"]);
});

test("post source falls back to committed data/ unless Blob is configured and seeded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "posts-"));
  writeFileSync(join(dir, "local.md"), serializePost({ title: "Local", date: "2024-01-01", notion: "l", url: "https://notion.so/l", excerpt: "", body: "from disk" }));
  const blob = fakeBlob();
  const get = blob.api.get;
  assert.deepEqual((await postSource({}, get, dir).posts()).map((post) => post.slug), ["local"]);
  assert.deepEqual((await postSource({ BLOB_READ_WRITE_TOKEN: "t", POSTS_SOURCE: "local" }, get, dir).posts()).map((post) => post.slug), ["local"]);
  const warn = console.warn;
  console.warn = () => {};
  assert.deepEqual((await postSource({ BLOB_READ_WRITE_TOKEN: "t" }, get, dir).posts()).map((post) => post.slug), ["local"]);
  console.warn = warn;
  await run(blob, source([page("a", "Alpha")]));
  const live = postSource({ BLOB_READ_WRITE_TOKEN: "t" }, get, dir);
  assert.deepEqual((await live.posts()).map((post) => post.slug), ["alpha"]);
  assert.match((await live.post("alpha"))!.body, /body of a/);
  assert.equal(await live.post("local"), null);
  const broken = postSource({ BLOB_READ_WRITE_TOKEN: "t" }, async () => { throw new Error("network down"); }, dir);
  await assert.rejects(broken.posts(), /network down/);
});

test("the local snapshot store writes only changed files and prunes unpublished ones", async () => {
  const { fsStore } = await import("../src/lib/sync");
  const { readdirSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "snapshot-")), raw = join(root, "raw"), posts = join(root, "posts");
  await syncPosts({ store: fsStore(raw, posts), source: source([page("a", "Alpha"), page("b", "Beta")]), ...stubs });
  assert.deepEqual([readdirSync(raw).sort(), readdirSync(posts).sort()], [["a.json", "b.json"], ["alpha.md", "beta.md"]]);
  const again = await syncPosts({ store: fsStore(raw, posts), source: source([page("a", "Alpha")]), ...stubs });
  assert.deepEqual([again.changed, again.removed, readdirSync(posts)], [[], ["beta"], ["alpha.md"]]);
});
