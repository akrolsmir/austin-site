import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import { BlobPreconditionFailedError } from "@vercel/blob";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db";
import { studioHandlers, type StudioDeps } from "../src/app/api/studio/handlers";
import { HEAD_PATH, overlayStore, type OverlayBlob } from "../src/lib/overlay";
import { CODE_LANE_UNAVAILABLE } from "../src/lib/studio/code";
import type { FastClient } from "../src/lib/studio/fast";
import { MAX_QUEUED, claimNextRun, finishRun, getRun } from "../src/lib/studio/store";
import { encodeAsk, decodeAsk, type CreatedThreadResponse, type PostedMessageResponse, type RunResponse, type ThreadResponse, type ThreadsResponse } from "../src/lib/studio/types";

// The studio routes' handlers: auth on every write, viewer filtering on reads, the not-configured paths, and the whole
// post → queue → run → poll → revert flow against PGlite, a scripted model, and an in-memory Blob.
let shared: Db | undefined;
async function fresh(): Promise<Db> {
  if (!shared) { shared = drizzle(new PGlite(), { schema }) as unknown as Db; await (await pushSchema(schema, shared as never)).apply(); }
  await shared.delete(schema.threads);
  return shared;
}
function fakeBlob() {
  const files = new Map<string, { text: string; etag: string }>();
  let version = 0;
  return { files, api: {
    async get(pathname: string) { const file = files.get(pathname); return file ? { statusCode: 200, stream: new Response(file.text).body, blob: { etag: file.etag } } : null; },
    async put(pathname: string, body: string | Buffer, options: { allowOverwrite?: boolean; ifMatch?: string }) {
      const existing = files.get(pathname);
      if (existing && !options.allowOverwrite) throw new Error("This blob already exists");
      if (options.ifMatch && existing?.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
      files.set(pathname, { text: String(body), etag: `e${++version}` });
      return { url: `https://store.public.blob.vercel-storage.com/${pathname}`, pathname };
    },
  } as unknown as OverlayBlob };
}
const OWNER = { NODE_ENV: "test", EDITOR_DEV_OWNER: "1" };
const BASE = "https://austin.site/api/studio";
let serial = 0;
const turn = (content: Array<{ text: string } | { tool: string; input: unknown }>) => ({
  id: `msg_${++serial}`, type: "message", role: "assistant", model: "m", stop_reason: content.some((block) => "tool" in block) ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
  content: content.map((block) => "tool" in block ? { type: "tool_use", id: `toolu_${++serial}`, name: block.tool, input: block.input } : { type: "text", text: block.text }),
}) as unknown as Anthropic.Message;
// The site as tests see it: `owner` handlers act as the signed-in owner, `visitor` handlers as anyone else, over one database.
function site(turns: Anthropic.Message[] = [], extra: StudioDeps = {}) {
  const blob = fakeBlob(), overlay = overlayStore({ BLOB_READ_WRITE_TOKEN: "token" }, blob.api), tasks: Array<() => Promise<void>> = [], asked: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let revalidated = 0;
  const client: FastClient = { messages: { async create(params) { asked.push(structuredClone(params)); const next = turns.shift(); if (!next) throw new Error("The script ran out of turns."); return next; } } };
  const deps: StudioDeps = { db: () => shared!, overlay: () => overlay, client, after: (task) => { tasks.push(task); }, revalidate: () => { revalidated++; }, ...extra };
  const settle = async () => { while (tasks.length) await tasks.shift()!(); };
  return { owner: studioHandlers({ ...deps, env: OWNER }), visitor: studioHandlers({ ...deps, env: {} }), overlay, blob, tasks, asked, settle, revalidated: () => revalidated };
}
const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) => new Request(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (path: string) => new Request(`${BASE}${path}`);
const read = async <T,>(response: Response | Promise<Response>, status = 200): Promise<T> => { const settled = await response; assert.equal(settled.status, status); assert.equal(settled.headers.get("cache-control"), "no-store"); return settled.json() as Promise<T>; };
const NOBODY = "00000000-0000-4000-8000-000000000000";

test("every studio write answers 401 without the owner and changes nothing", async () => {
  const db = await fresh();
  const { owner, visitor, tasks, settle } = site([turn([{ text: "Hi." }])]);
  const made = await read<CreatedThreadResponse>(owner.createThread(post("/threads", { body: "Hello" })), 201);
  await settle();
  const before = JSON.stringify([await db.select().from(schema.threads), await db.select().from(schema.messages), await db.select().from(schema.runs)]);
  for (const env of [{}, { NODE_ENV: "production", EDITOR_DEV_OWNER: "1" }, { NODE_ENV: "test", EDITOR_DEV_OWNER: "0" }]) {
    const anyone = studioHandlers({ db: () => db, env, after: (task) => { tasks.push(task); } });
    const responses = [
      await anyone.createThread(post("/threads", { body: "Deface the site" })), await anyone.postMessage(post(`/threads/${made.thread.id}/messages`, { body: "Deface the site" }), made.thread.id),
      await anyone.stop(post(`/runs/${made.run.id}/stop`), made.run.id), await anyone.revert(post(`/runs/${made.run.id}/revert`), made.run.id), await anyone.publish(post(`/runs/${made.run.id}/publish`), made.run.id),
      await anyone.createThread(post("/threads", "{not json", { "content-type": "text/plain", "sec-fetch-site": "cross-site" })), // the owner check comes before any other check
    ];
    for (const response of responses) assert.deepEqual([response.status, await response.json()], [401, { error: "Sign in as the owner." }]);
  }
  assert.equal(JSON.stringify([await db.select().from(schema.threads), await db.select().from(schema.messages), await db.select().from(schema.runs)]), before);
  assert.equal(tasks.length, 0);
  void visitor;
});

test("when the database is not configured, reads are empty and well formed and writes are 503", async () => {
  const tasks: unknown[] = [];
  const bare = studioHandlers({ env: OWNER, after: (task) => { tasks.push(task); } });
  assert.deepEqual(await read<ThreadsResponse>(bare.threads(get("/threads"))), { configured: false, owner: false, threads: [] });
  const thread = await read<ThreadResponse>(bare.thread(get(`/threads/${NOBODY}`), NOBODY));
  assert.deepEqual({ ...thread, at: "" }, { configured: false, owner: false, thread: null, messages: [], runs: [], at: "" });
  assert.ok(!Number.isNaN(Date.parse(thread.at)));
  for (const response of [bare.createThread(post("/threads", { body: "Hello" })), bare.postMessage(post("/x", { body: "Hello" }), NOBODY), bare.stop(post("/x"), NOBODY), bare.revert(post("/x"), NOBODY), bare.publish(post("/x"), NOBODY)]) {
    assert.deepEqual(await read(response, 503), { error: "The studio is not set up on this site yet." });
  }
  assert.equal((await studioHandlers({ env: {} }).createThread(post("/threads", { body: "Hello" }))).status, 401); // no env at all: nobody is the owner
  assert.equal(tasks.length, 0);

  // The real route modules, with no env: importable, public reads empty, writes refused.
  const env = { ...process.env };
  for (const key of ["DATABASE_URL", "EDITOR_DEV_OWNER", "BETTER_AUTH_SECRET"]) delete process.env[key];
  try {
    const threads = await import("../src/app/api/studio/threads/route"), one = await import("../src/app/api/studio/threads/[id]/route"), messages = await import("../src/app/api/studio/threads/[id]/messages/route");
    const stop = await import("../src/app/api/studio/runs/[id]/stop/route"), revert = await import("../src/app/api/studio/runs/[id]/revert/route"), publish = await import("../src/app/api/studio/runs/[id]/publish/route");
    const params = { params: Promise.resolve({ id: NOBODY }) };
    assert.deepEqual(await read(threads.GET(get("/threads"))), { configured: false, owner: false, threads: [] });
    assert.equal((await read<ThreadResponse>(one.GET(get(`/threads/${NOBODY}`), params))).configured, false);
    for (const response of [threads.POST(post("/threads", { body: "x" })), messages.POST(post("/x", { body: "x" }), params), stop.POST(post("/x"), params), revert.POST(post("/x"), params), publish.POST(post("/x"), params)]) assert.equal((await response).status, 401);
    for (const route of [threads, one, messages, stop, revert, publish]) assert.deepEqual([route.dynamic, route.maxDuration], ["force-dynamic", 300]);
  } finally { Object.assign(process.env, env); }
});

test("post → queue → run → poll: the owner asks, the fast lane publishes, visitors watch, the owner reverts", async () => {
  await fresh();
  const { owner, visitor, overlay, tasks, asked, settle, revalidated } = site([
    turn([{ tool: "publish_overlay", input: { patch: { "site.wordmark": "Austin C." }, summary: "Renamed the wordmark" } }]), turn([{ text: "The wordmark now reads Austin C." }]),
    turn([{ text: "Yes, it does." }]),
  ]);
  const context = decodeAsk(encodeAsk({ route: "/", slot: "site.wordmark", text: "Austin Chen" }))!;
  const made = await read<CreatedThreadResponse>(owner.createThread(post("/threads", { body: "  Rename the wordmark to Austin C.  ", context })), 201);
  assert.deepEqual([made.thread.title, made.thread.private, made.thread.status], ["Rename the wordmark to Austin C.", false, "queued"]);
  assert.deepEqual([made.message.body, made.message.role, made.message.runId, made.message.context], ["Rename the wordmark to Austin C.", "owner", made.run.id, context]);
  assert.deepEqual([made.run.status, made.run.lane, made.run.steps, made.run.can], ["queued", "fast", [], { stop: true, revert: false, publish: false }]);
  const follow = await read<PostedMessageResponse>(owner.postMessage(post(`/threads/${made.thread.id}/messages`, { body: "Does it fit?" }), made.thread.id), 201);
  assert.equal(follow.run.status, "queued"); // behind the first
  assert.equal(tasks.length, 2);
  assert.equal(asked.length, 0); // nothing ran inside the request

  const waiting = await read<ThreadResponse>(visitor.thread(get(`/threads/${made.thread.id}`), made.thread.id));
  assert.deepEqual([waiting.configured, waiting.owner, waiting.messages.length, waiting.runs.map((run) => run.status)], [true, false, 2, ["queued", "queued"]]);
  assert.ok(waiting.messages.every((message) => !("context" in message)) && waiting.runs.every((run) => !("logs" in run)));
  await settle();

  const done = await read<ThreadResponse>(visitor.thread(get(`/threads/${made.thread.id}?after=${encodeURIComponent(waiting.at)}`), made.thread.id));
  assert.deepEqual(done.messages.map((message) => [message.role, message.body]), [["owner", "Rename the wordmark to Austin C."], ["owner", "Does it fit?"], ["claude", "The wordmark now reads Austin C."], ["claude", "Yes, it does."]].slice(-done.messages.length));
  assert.ok(done.messages.some((message) => message.body === "Yes, it does."));
  assert.deepEqual(done.runs.map((run) => [run.id, run.status]), [[made.run.id, "done"], [follow.run.id, "done"]]);
  assert.deepEqual(done.runs[0].steps.map((step) => [step.text, step.state]), [["Reading your message", "done"], ["Publishing 1 change", "done"]]);
  assert.equal(asked[2].messages.length, 3); // the follow-up saw the first exchange
  assert.match(JSON.stringify(asked[0].messages[0]), /pointing at page \/, slot site\.wordmark/);
  assert.deepEqual((await overlay.read()).overlay, { "site.wordmark": "Austin C." });
  assert.equal(revalidated(), 1);
  const quiet = await read<ThreadResponse>(visitor.thread(get(`/threads/${made.thread.id}?after=${encodeURIComponent(new Date(Date.now() + 60000).toISOString())}`), made.thread.id));
  assert.deepEqual([quiet.messages, quiet.runs, quiet.thread!.status], [[], [], "done"]);
  assert.equal((await read<ThreadResponse>(owner.thread(get(`/threads/${made.thread.id}`), made.thread.id))).owner, true);
  assert.deepEqual((await read<ThreadsResponse>(visitor.threads(get("/threads")))).threads.map((thread) => [thread.id, thread.status]), [[made.thread.id, "done"]]);

  // Revert: the site goes back to what was live before the run, once.
  const published = done.runs[0];
  assert.deepEqual(published.can, { stop: false, revert: true, publish: false });
  assert.equal((await owner.revert(post(`/runs/${follow.run.id}/revert`), follow.run.id)).status, 409); // it published nothing
  const reverted = await read<RunResponse>(owner.revert(post(`/runs/${made.run.id}/revert`), made.run.id));
  assert.deepEqual([reverted.run.status, reverted.run.can.revert, reverted.run.result!.overlayHash], ["reverted", false, published.result!.overlayHash]);
  assert.deepEqual((await overlay.read()).overlay, {});
  assert.deepEqual((await overlay.read()).head.history.map((entry) => entry.by), ["revert", `studio:${made.run.id}`]);
  assert.equal(revalidated(), 2);
  assert.deepEqual(await read(owner.revert(post(`/runs/${made.run.id}/revert`), made.run.id), 409), { error: "This run has nothing to revert." });
  assert.equal(tasks.length, 0);
});

test("a revert goes back to the version before the run when there was one", async () => {
  await fresh();
  const { owner, overlay, settle } = site([turn([{ tool: "publish_overlay", input: { patch: { "site.footer": "Second" }, summary: "Footer" } }]), turn([{ text: "Done." }])]);
  const first = await overlay.publish({ "site.footer": "First" }, { summary: "By hand", by: "editor" });
  const made = await read<CreatedThreadResponse>(owner.createThread(post("/threads", { body: "Change the footer to Second" })), 201);
  await settle();
  assert.equal((await getRun(shared!, made.run.id))!.result!.previousOverlayHash, first.hash);
  await read<RunResponse>(owner.revert(post(`/runs/${made.run.id}/revert`), made.run.id));
  assert.deepEqual((await overlay.read()).overlay, { "site.footer": "First" });
  // Without Blob the revert is refused and the run keeps its state.
  const again = site([turn([{ tool: "publish_overlay", input: { patch: { "site.footer": "Third" }, summary: "Footer" } }]), turn([{ text: "Done." }])], { overlay: () => overlay });
  const next = await read<CreatedThreadResponse>(again.owner.createThread(post("/threads", { body: "Third" })), 201);
  await again.settle();
  const offline = studioHandlers({ db: () => shared!, env: OWNER, overlay: () => overlayStore({}, fakeBlob().api) });
  assert.equal((await offline.revert(post(`/runs/${next.run.id}/revert`), next.run.id)).status, 503);
  assert.equal((await getRun(shared!, next.run.id))!.status, "done");
});

test("private threads and messages exist only for the owner", async () => {
  await fresh();
  const { owner, visitor, settle } = site([turn([{ text: "SECRET reply" }]), turn([{ text: "Public reply" }]), turn([{ text: "SECRET aside reply" }])]);
  const hidden = await read<CreatedThreadResponse>(owner.createThread(post("/threads", { body: "SECRET plan", private: true })), 201);
  const open = await read<CreatedThreadResponse>(owner.createThread(post("/threads", { body: "Public question" })), 201);
  const aside = await read<PostedMessageResponse>(owner.postMessage(post(`/threads/${open.thread.id}/messages`, { body: "SECRET aside", private: true }), open.thread.id), 201);
  await settle();
  assert.deepEqual(await read(visitor.thread(get(`/threads/${hidden.thread.id}`), hidden.thread.id), 404), { error: "There is no such thread." });
  assert.deepEqual(await read(visitor.thread(get(`/threads/${NOBODY}`), NOBODY), 404), { error: "There is no such thread." }); // the same answer as for a thread that never existed
  const list = await read<ThreadsResponse>(visitor.threads(get("/threads"))), thread = await read<ThreadResponse>(visitor.thread(get(`/threads/${open.thread.id}`), open.thread.id));
  assert.deepEqual(list.threads.map((item) => item.id), [open.thread.id]);
  assert.deepEqual(thread.messages.map((message) => message.body), ["Public question", "Public reply"]);
  assert.deepEqual(thread.runs.map((run) => run.id), [open.run.id]);
  for (const payload of [list, thread]) assert.ok(!JSON.stringify(payload).includes("SECRET") && !JSON.stringify(payload).includes(aside.run.id));
  const mine = await read<ThreadsResponse>(owner.threads(get("/threads")));
  assert.deepEqual([mine.owner, mine.threads.length, mine.threads.find((item) => item.id === hidden.thread.id)!.private], [true, 2, true]);
  assert.equal((await read<ThreadResponse>(owner.thread(get(`/threads/${open.thread.id}`), open.thread.id))).messages.length, 4);
  assert.ok((await read<ThreadResponse>(owner.thread(get(`/threads/${hidden.thread.id}`), hidden.thread.id))).runs[0].logs);
});

test("writes validate their input and refuse what is not same-origin JSON", async () => {
  await fresh();
  const { owner, tasks } = site();
  const create = (body: unknown, headers?: Record<string, string>) => owner.createThread(post("/threads", body, headers));
  assert.equal((await create({ body: "x" }, { "content-type": "text/plain" })).status, 415);
  assert.deepEqual(await read(create({ body: "x" }, { "sec-fetch-site": "cross-site" }), 403), { error: "Cross-site requests are not allowed." });
  assert.equal((await create({ body: "x" }, { "sec-fetch-site": "same-site" })).status, 403);
  assert.equal((await create("{not json")).status, 400);
  assert.equal((await create([])).status, 400);
  for (const bad of [{}, { body: "" }, { body: "   " }, { body: 5 }, { body: "x".repeat(8001) }, { body: "a\u0000b" }, { body: "x", private: "yes" }, { body: "x", context: "home" }, { body: "x", context: { route: "https://evil.example/" } }, { body: "x", context: { slot: "home.intro", extra: 1 } }]) assert.equal((await create(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  assert.equal((await create({ body: "x".repeat(70000) })).status, 413);
  assert.equal((await shared!.select().from(schema.threads)).length, 0);
  assert.equal((await owner.postMessage(post("/x", { body: "x" }), NOBODY)).status, 404);
  assert.equal((await owner.postMessage(post("/x", { body: "x" }), "'; drop table threads; --")).status, 404);
  for (const act of [owner.stop, owner.revert, owner.publish]) { assert.equal((await act(post("/x"), NOBODY)).status, 404); assert.equal((await act(post("/x"), "nope")).status, 404); }
  assert.equal((await owner.thread(get(`/threads/${NOBODY}?after=yesterday`), NOBODY)).status, 400);
  assert.equal((await read<CreatedThreadResponse>(create({ body: "x".repeat(8000) }), 201)).message.body.length, 8000);
  // The queue is bounded: once it is full, nothing more is stored.
  for (let i = 1; i < MAX_QUEUED; i++) assert.equal((await create({ body: `request ${i}` })).status, 201);
  assert.deepEqual(await read(create({ body: "one too many" }), 429), { error: "Too many requests are waiting. Let some finish first." });
  assert.equal((await shared!.select().from(schema.threads)).length, MAX_QUEUED);
  assert.equal(tasks.length, MAX_QUEUED);
});

test("stop, publish, and the scheduler tick on reads", async () => {
  const db = await fresh();
  const executed: string[] = [];
  const { owner, visitor, tasks, settle } = site([], { execute: async (run) => { executed.push(run.id); await finishRun(db, run.id, { status: "done" }); } });
  const first = await read<CreatedThreadResponse>(owner.createThread(post("/threads", { body: "one" })), 201), second = await read<CreatedThreadResponse>(owner.createThread(post("/threads", { body: "two" })), 201);
  tasks.length = 0; // as if the functions that should have run them died
  const stopped = await read<RunResponse>(owner.stop(post(`/runs/${second.run.id}/stop`), second.run.id));
  assert.deepEqual([stopped.run.status, stopped.run.can.stop], ["stopped", false]);
  await claimNextRun(db);
  const flagged = await read<RunResponse>(owner.stop(post(`/runs/${first.run.id}/stop`), first.run.id));
  assert.deepEqual([flagged.run.status, flagged.run.stopRequested], ["running", true]);
  assert.equal((await owner.publish(post(`/runs/${first.run.id}/publish`), first.run.id)).status, 409); // not waiting for approval
  await finishRun(db, first.run.id, { status: "needs_publish" });
  assert.deepEqual(await read(owner.publish(post(`/runs/${first.run.id}/publish`), first.run.id), 503), { error: CODE_LANE_UNAVAILABLE }); // no GitHub token here
  assert.equal((await getRun(db, first.run.id))!.status, "needs_publish"); // a publish that could not happen leaves the run waiting
  await finishRun(db, first.run.id, { status: "failed" });

  // A read finds a queue nobody is working on and wakes it; a read with nothing waiting schedules nothing.
  await read(visitor.threads(get("/threads")));
  assert.equal(tasks.length, 0);
  const third = await read<CreatedThreadResponse>(owner.createThread(post("/threads", { body: "three" })), 201), fourth = await read<CreatedThreadResponse>(owner.createThread(post("/threads", { body: "four" })), 201);
  tasks.length = 0;
  await read(visitor.thread(get(`/threads/${third.thread.id}`), third.thread.id));
  assert.equal(tasks.length, 1);
  await settle();
  assert.deepEqual(executed, [third.run.id, fourth.run.id]); // one drain works through the queue in order

  // A run whose function died is failed by the next read, and the queue moves on.
  const fifth = await read<CreatedThreadResponse>(owner.createThread(post("/threads", { body: "five" })), 201), sixth = await read<CreatedThreadResponse>(owner.createThread(post("/threads", { body: "six" })), 201);
  tasks.length = 0;
  await claimNextRun(db, new Date(Date.now() - 16 * 60 * 1000));
  const seen = await read<ThreadResponse>(visitor.thread(get(`/threads/${fifth.thread.id}`), fifth.thread.id));
  assert.deepEqual([seen.runs[0].status, seen.runs[0].result], ["failed", { error: "This run stopped responding and was ended." }]);
  await settle();
  assert.deepEqual(executed.at(-1), sixth.run.id);
  // A run that throws is failed in plain words and does not stop the queue.
  const crash = site([], { execute: async () => { throw new Error("boom with DETAIL"); } });
  const error = console.error; console.error = () => {};
  try {
    const broken = await read<CreatedThreadResponse>(crash.owner.createThread(post("/threads", { body: "seven" })), 201);
    await crash.settle();
    assert.deepEqual((await getRun(db, broken.run.id))!.result, { error: "Something went wrong on the site's side." });
  } finally { console.error = error; }
  assert.equal(HEAD_PATH, "site/overlay/head.json");
});
