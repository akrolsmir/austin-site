import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import { BlobPreconditionFailedError } from "@vercel/blob";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db";
import { HEAD_PATH, overlayStore, type Head, type OverlayBlob } from "../src/lib/overlay";
import { CODE_LANE_UNAVAILABLE } from "../src/lib/studio/code";
import { FAST_MODEL, NO_KEY, SYSTEM, TOOLS, pageText, readablePath, runFast, type FastClient, type FastDeps } from "../src/lib/studio/fast";
import { CODE_RUNS_PER_DAY, claimNextRun, createThread, getRun, getThread, postMessage, requestStop, startRun } from "../src/lib/studio/store";

// The fast lane's tool loop with a scripted model: each test lists the model's turns, and everything else is real
// (PGlite with the real schema, the real overlay store over an in-memory Blob).
let shared: Db | undefined;
async function fresh(): Promise<Db> {
  if (!shared) { shared = drizzle(new PGlite(), { schema }) as unknown as Db; await (await pushSchema(schema, shared as never)).apply(); }
  await shared.delete(schema.threads);
  return shared;
}
function fakeBlob() {
  const files = new Map<string, { text: string; etag: string }>();
  let version = 0;
  const api = {
    async get(pathname: string) { const file = files.get(pathname); return file ? { statusCode: 200, stream: new Response(file.text).body, blob: { etag: file.etag } } : null; },
    async put(pathname: string, body: string | Buffer, options: { allowOverwrite?: boolean; ifMatch?: string }) {
      const existing = files.get(pathname);
      if (existing && !options.allowOverwrite) throw new Error("This blob already exists");
      if (options.ifMatch && existing?.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
      files.set(pathname, { text: String(body), etag: `e${++version}` });
      return { url: `https://store.public.blob.vercel-storage.com/${pathname}`, pathname };
    },
  };
  return { api: api as unknown as OverlayBlob, head: (): Head => JSON.parse(files.get(HEAD_PATH)!.text) };
}
type Params = Anthropic.MessageCreateParamsNonStreaming;
type Turn = Anthropic.Message | ((params: Params) => Anthropic.Message | Promise<Anthropic.Message>);
let serial = 0;
const reply = (content: Array<{ text: string } | { tool: string; input: unknown }>, stop_reason: Anthropic.StopReason = content.some((block) => "tool" in block) ? "tool_use" : "end_turn") => ({
  id: `msg_${++serial}`, type: "message", role: "assistant", model: FAST_MODEL, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
  content: content.map((block) => "tool" in block ? { type: "tool_use", id: `toolu_${++serial}`, name: block.tool, input: block.input } : { type: "text", text: block.text }),
}) as unknown as Anthropic.Message;
const use = (tool: string, input: unknown = {}) => reply([{ tool, input }]);
const say = (text: string) => reply([{ text }]);
function script(turns: Turn[]) {
  const seen: Params[] = [];
  const client: FastClient = { messages: { async create(params) {
    seen.push(structuredClone(params));
    const turn = turns[seen.length - 1];
    if (!turn) throw new Error("The script ran out of turns.");
    return typeof turn === "function" ? turn(params) : turn;
  } } };
  return { client, seen };
}
// What the model was told about its tool calls in request `index` (the last user message's tool results).
const results = (seen: Params[], index: number) => (seen[index].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[]).map((block) => ({ error: block.is_error === true, body: String(block.content) }));

async function begin(body: string, options: { hidden?: boolean; context?: schema.MessageContext; threadId?: string } = {}) {
  const db = shared!, threadId = options.threadId ?? (await createThread(db, { body, private: options.hidden })).id;
  const message = (await postMessage(db, { threadId, role: "owner", body, private: options.hidden, context: options.context }))!;
  await startRun(db, { threadId, messageId: message.id });
  return (await claimNextRun(db))!;
}
function world(turns: Turn[], extra: Partial<FastDeps> = {}) {
  const blob = fakeBlob(), model = script(turns);
  let revalidated = 0;
  const deps: FastDeps = { db: shared!, overlay: overlayStore({ BLOB_READ_WRITE_TOKEN: "token" }, blob.api), env: {}, client: model.client, origin: "https://austin.site", revalidate: () => { revalidated++; }, fetch: (async () => { throw new Error("no fetch in this test"); }) as unknown as typeof fetch, ...extra };
  return { deps, blob, seen: model.seen, revalidated: () => revalidated };
}
const state = async (run: { id: string; threadId: string }, viewer: "owner" | "public" = "public") => {
  const detail = (await getThread(shared!, viewer, run.threadId))!;
  return { run: detail.runs.find((item) => item.id === run.id)!, messages: detail.messages, steps: detail.runs.find((item) => item.id === run.id)!.steps.map((step) => [step.text, step.state]) };
};
const quiet = async (work: () => Promise<void>) => { const error = console.error, lines: string[] = []; console.error = (...args: unknown[]) => { lines.push(args.join(" ")); }; try { await work(); } finally { console.error = error; } return lines; };

test("publish path: reads the slots, publishes through the overlay as studio:<run>, revalidates, and replies", async () => {
  await fresh();
  const run = await begin("Rename the wordmark to Austin C. and make links green");
  const { deps, blob, seen, revalidated } = world([use("read_slots"), use("publish_overlay", { patch: { "site.wordmark": "Austin C.", "theme.link": "#0A7F3F" }, summary: "Renamed the wordmark and made links green" }), say("The wordmark now reads Austin C. and links are green.")]);
  await runFast(deps, run);

  const after = await state(run);
  assert.equal(after.run.status, "done");
  assert.equal(after.run.summary, "Renamed the wordmark and made links green");
  assert.deepEqual(after.run.result, { overlayHash: blob.head().current }); // no previous version: Revert goes back to the defaults
  assert.deepEqual(after.steps, [["Reading your message", "done"], ["Reading the site's editable values", "done"], ["Publishing 2 changes", "done"]]);
  assert.deepEqual(after.messages.map((message) => [message.role, message.body, message.runId]), [["owner", "Rename the wordmark to Austin C. and make links green", run.id], ["claude", "The wordmark now reads Austin C. and links are green.", run.id]]);
  assert.deepEqual(blob.head().history.map(({ summary, by }) => [summary, by]), [["Renamed the wordmark and made links green", `studio:${run.id}`]]);
  assert.deepEqual((await deps.overlay.read()).overlay, { "site.wordmark": "Austin C.", "theme.link": "#0a7f3f" });
  assert.equal(revalidated(), 1);

  assert.equal(seen.length, 3);
  assert.deepEqual([seen[0].model, seen[0].system, seen[0].tools, seen[0].tool_choice], [FAST_MODEL, SYSTEM, TOOLS, undefined]);
  assert.deepEqual(seen[0].messages, [{ role: "user", content: "Rename the wordmark to Austin C. and make links green" }]);
  const slots = JSON.parse(results(seen, 1)[0].body);
  assert.deepEqual(slots.slots["site.wordmark"], { kind: "text", label: "Wordmark", group: "Site", max: 40, multiline: false, value: slots.slots["site.wordmark"].default, default: slots.slots["site.wordmark"].default });
  assert.equal(slots.fonts.figtree, "Figtree");
  assert.deepEqual(results(seen, 2), [{ error: false, body: JSON.stringify({ published: true, slots: ["site.wordmark", "theme.link"] }) }]);
  assert.deepEqual(seen[2].messages.map((message) => message.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.deepEqual(TOOLS.map((tool) => tool.name), ["read_slots", "read_page", "publish_overlay", "escalate_to_code"]);
  assert.deepEqual((await state(run, "owner")).run.logs!.map((log) => log.text.split(" ")[0]), ["read_slots", "publish_overlay"]);
});

test("a validation error goes back to the model, which corrects it; a later run records the version before it", async () => {
  await fresh();
  const first = await begin("Make the text navy");
  const one = world([use("publish_overlay", { patch: { "theme.ink": "navy", "site.wordmark": "Kept" }, summary: "Navy text" }), use("publish_overlay", { patch: { "theme.ink": "#000080" }, summary: "Navy text" }), say("Text is navy now.")]);
  await runFast(one.deps, first);
  const failed = results(one.seen, 1)[0];
  assert.equal(failed.error, true);
  assert.deepEqual(Object.keys(JSON.parse(failed.body).slots), ["theme.ink"]);
  assert.match(failed.body, /Nothing was published/);
  const after = await state(first);
  assert.equal(after.run.status, "done");
  assert.deepEqual(after.steps.slice(1), [["Publishing 2 changes", "failed"], ["Publishing 1 change", "done"]]);
  assert.deepEqual((await one.deps.overlay.read()).overlay, { "theme.ink": "#000080" }); // the rejected patch published nothing, not even its valid half
  assert.equal(one.revalidated(), 1);

  // A second run on the same site: two publishes in one run keep the version from before the first as the revert target.
  const second = await begin("Now maroon, then red");
  const two = world([use("publish_overlay", { patch: { "theme.ink": "#800000" }, summary: "Maroon" }), use("publish_overlay", { patch: { "theme.ink": "#ff0000" }, summary: "Red" }), use("publish_overlay", { patch: { "theme.ink": "#ff0000" }, summary: "Red again" }), say("Red.")], { overlay: one.deps.overlay });
  await runFast(two.deps, second);
  const done = await state(second);
  assert.deepEqual(done.run.result, { overlayHash: one.blob.head().current, previousOverlayHash: after.run.result!.overlayHash });
  assert.equal(done.run.summary, "Red");
  assert.match(results(two.seen, 3)[0].body, /Nothing changed/);
  assert.equal(two.revalidated(), 2);
});

test("bad tool input, a lost race, and missing storage are reported to the model without ending the run", async () => {
  await fresh();
  const run = await begin("Change things");
  const { deps, seen, revalidated } = world([
    reply([{ tool: "publish_overlay", input: { patch: [], summary: "x" } }, { tool: "publish_overlay", input: { patch: { "no.such.slot": "x" }, summary: "x" } }, { tool: "no_such_tool", input: {} }]),
    say("I could not publish that."),
  ], { overlay: overlayStore({}, fakeBlob().api) });
  await runFast(deps, run);
  const [shape, unknown, tool] = results(seen, 1);
  assert.deepEqual([shape.error, unknown.error, tool.error], [true, true, true]);
  assert.match(shape.body, /must be an object/);
  assert.match(unknown.body, /storage is not set up/); // OverlayUnavailable: no Blob token
  assert.match(tool.body, /no such tool/);
  assert.equal((await state(run)).run.status, "done");
  assert.equal((await state(run)).run.result, null);
  assert.equal(revalidated(), 0);

  const racing = await begin("Race");
  const blob = fakeBlob(), store = overlayStore({ BLOB_READ_WRITE_TOKEN: "token" }, blob.api);
  const lost = world([use("publish_overlay", { patch: { "site.wordmark": "Mine" }, summary: "Mine" }), say("Someone else changed the site first.")], { overlay: { ...store, publish: async (patch, meta) => { await store.publish({ "site.footer": "Theirs" }, { summary: "Theirs", by: "editor" }); const { OverlayConflict } = await import("../src/lib/overlay"); void patch; void meta; throw new OverlayConflict(); } } });
  await runFast(lost.deps, racing);
  assert.match(results(lost.seen, 1)[0].body, /changed at the same moment/);
  assert.deepEqual((await store.read()).overlay, { "site.footer": "Theirs" });
  assert.equal((await state(racing)).run.result, null);
});

test("read_page reads only this site's own pages, as capped text", async () => {
  await fresh();
  const run = await begin("What does the homepage say?");
  const fetched: Array<{ url: string; redirect?: string }> = [];
  const page = "<!doctype html><html><head><title>T</title><style>p{color:red}</style></head><body><script>alert('x')</script><h1>Austin&nbsp;Chen &amp; co</h1><p>Hello <b>there</b>&#33;</p><!-- hidden --><p>&lt;script&gt;</p></body></html>";
  const fetchPage = (async (input: URL, init: RequestInit) => {
    fetched.push({ url: String(input), redirect: init.redirect });
    if (input.pathname === "/moved") return new Response(null, { status: 307, headers: { location: "https://elsewhere.example/" } });
    if (input.pathname === "/missing") return new Response("nope", { status: 404 });
    if (input.pathname === "/feed.xml") return new Response("<rss/>", { headers: { "content-type": "application/xml" } });
    return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  }) as unknown as typeof fetch;
  const paths = ["/", "/posts?page=2", "https://evil.example/", "//evil.example/x", "/\\evil.example", "/api/overlay", "/API/sync", "/_next/data", "posts", 7, "/moved", "/missing", "/feed.xml"];
  const { deps, seen } = world([reply(paths.map((path) => ({ tool: "read_page", input: { path } }))), say("It says hello.")], { fetch: fetchPage });
  await runFast(deps, run);
  const read = results(seen, 1);
  assert.deepEqual(fetched, [{ url: "https://austin.site/", redirect: "manual" }, { url: "https://austin.site/posts?page=2", redirect: "manual" }, { url: "https://austin.site/moved", redirect: "manual" }, { url: "https://austin.site/missing", redirect: "manual" }, { url: "https://austin.site/feed.xml", redirect: "manual" }]);
  assert.deepEqual(read[0], { error: false, body: "Austin Chen & co\nHello there !\n<script>" });
  assert.deepEqual(read.map((item) => item.error), [false, false, true, true, true, true, true, true, true, true, true, true, true]);
  assert.match(read[10].body, /redirects to another site/);
  assert.match(read[11].body, /no page at that path/);
  const after = await state(run);
  assert.deepEqual(after.steps.slice(1, 4), [["Reading the homepage", "done"], ["Reading /posts", "done"], ["Reading a page", "failed"]]);
  assert.equal(after.run.status, "done");

  assert.equal(pageText("<p>a</p>".repeat(5000), 50).length, 50 + "\n[The page continues; this is the first 50 characters.]".length);
  assert.equal(pageText("<svg><text>icon</text></svg><noscript>no</noscript>x &#0; &#xD800; &bogus; &#x41;"), "x &bogus; A");
  for (const [path, allowed] of [["/", true], ["/posts/a-guide", true], ["/apiary", true], ["/api", false], ["/api?x", false], ["/api/me", false], ["", false], ["/a b", false], [null, false]] as const) assert.equal(readablePath(path), allowed, String(path));
});

test("escalation hands the run to the code lane; the daily cap is reported to the model", async () => {
  await fresh();
  const run = await begin("Add a guestbook page");
  const handed: Array<{ id: string; brief?: string }> = [];
  const first = world([reply([{ text: "This needs new pages, so I am handing it to the code lane." }, { tool: "escalate_to_code", input: { brief: "  Add a /guestbook page with a form.  " } }, { tool: "read_slots", input: {} }])], { startCode: async (_deps, target, brief) => { handed.push({ id: target.id, brief }); return { ok: true }; } });
  await runFast(first.deps, run);
  assert.deepEqual(handed, [{ id: run.id, brief: "Add a /guestbook page with a form." }]);
  const moved = await state(run);
  assert.deepEqual([moved.run.lane, moved.run.status], ["code", "running"]); // the code lane owns it from here
  assert.deepEqual(moved.steps, [["Reading your message", "done"], ["Handing this to the code lane", "doing"]]);
  assert.deepEqual(moved.messages.map((message) => message.body), ["Add a guestbook page", "This needs new pages, so I am handing it to the code lane."]);
  assert.equal(first.seen.length, 1);

  // With the real code lane and nothing configured (no keys in this env) the run fails in plain words.
  await shared!.delete(schema.threads);
  const stubbed = await begin("Add a guestbook page");
  await runFast(world([use("escalate_to_code", { brief: "Add a guestbook." })]).deps, stubbed);
  const failed = await state(stubbed);
  assert.deepEqual([failed.run.lane, failed.run.status, failed.run.result], ["code", "failed", { error: CODE_LANE_UNAVAILABLE }]);
  assert.equal(CODE_LANE_UNAVAILABLE, "The code lane isn't set up yet.");

  // At the cap nothing is handed over: the model hears about it and tells the owner.
  await shared!.delete(schema.runs);
  for (let i = 0; i < CODE_RUNS_PER_DAY; i++) await shared!.insert(schema.runs).values({ id: crypto.randomUUID(), threadId: stubbed.threadId, messageId: stubbed.messageId, lane: "code", status: "done" });
  const capped = await begin("And a second page", { threadId: stubbed.threadId });
  const last = world([use("escalate_to_code", { brief: "Another page." }), use("escalate_to_code", { brief: "" }), say("The code lane is at its limit for today.")], { startCode: async () => { throw new Error("must not start"); } });
  await runFast(last.deps, capped);
  assert.match(results(last.seen, 1)[0].body, /limit of 30 runs/);
  assert.deepEqual([(await getRun(shared!, capped.id))!.lane, (await getRun(shared!, capped.id))!.status], ["fast", "done"]);
});

test("stop is honoured between turns", async () => {
  await fresh();
  const run = await begin("Rename everything");
  const { deps, blob, seen } = world([async () => { await requestStop(shared!, run.id); return use("publish_overlay", { patch: { "site.wordmark": "Half" }, summary: "Half done" }); }, say("never reached")]);
  await runFast(deps, run);
  const after = await state(run);
  assert.equal(seen.length, 1);
  assert.deepEqual([after.run.status, after.run.stopRequested, after.run.summary], ["stopped", false, "Half done"]);
  assert.deepEqual(after.run.result, { overlayHash: blob.head().current }); // what was already published is recorded
  assert.deepEqual(after.run.can, { stop: false, revert: true, publish: false });
  assert.equal(after.messages.length, 1);

  const early = await begin("Stopped before it began");
  await requestStop(shared!, early.id);
  const never = world([say("never reached")]);
  await runFast(never.deps, early);
  assert.equal(never.seen.length, 0);
  assert.equal((await state(early)).run.status, "stopped");
});

test("the loop is bounded: too many turns fails the run in plain words", async () => {
  await fresh();
  const run = await begin("Loop forever");
  const { deps, seen } = world(Array.from({ length: 10 }, () => use("read_slots")), { maxTurns: 3 });
  await runFast(deps, run);
  const after = await state(run);
  assert.equal(seen.length, 3);
  assert.deepEqual([after.run.status, after.run.result], ["failed", { error: "This took more steps than a quick edit should. Try asking for a smaller change." }]);
  assert.equal(after.messages.length, 1);
  assert.ok(after.steps.every(([, step]) => step !== "doing"));
});

test("without ANTHROPIC_API_KEY the run fails with a clear public message", async () => {
  await fresh();
  for (const extra of [{ client: undefined, env: {} }, { client: undefined, env: { ANTHROPIC_API_KEY: "" } }, { client: null, env: { ANTHROPIC_API_KEY: "sk-ant-ignored" } }] as Array<Partial<FastDeps>>) {
    const run = await begin("Hello?");
    await runFast(world([], extra).deps, run);
    const after = await state(run);
    assert.deepEqual([after.run.status, after.run.result], ["failed", { error: NO_KEY }]);
    assert.equal(after.messages.length, 1);
    await shared!.delete(schema.threads);
  }
});

test("model failures become plain sentences; nothing from the upstream error is stored or logged", async () => {
  await fresh();
  const cases: Array<[Turn, RegExp]> = [
    [() => { throw new Anthropic.AuthenticationError(401, { error: { message: "UPSTREAM-BODY sk-ant-leak" } }, "UPSTREAM-BODY", new Headers()); }, /key was not accepted/],
    [() => { throw new Anthropic.RateLimitError(429, { error: { message: "UPSTREAM-BODY" } }, "UPSTREAM-BODY", new Headers()); }, /busy right now/],
    [() => { throw new Error("UPSTREAM-BODY socket"); }, /Something went wrong while talking to Claude/],
    [reply([{ text: "UPSTREAM-BODY" }], "refusal"), /declined this request/],
    [reply([{ text: "UPSTREAM-BODY partial" }], "max_tokens"), /cut short/],
  ];
  for (const [turn, expected] of cases) {
    const run = await begin("Hello?");
    const lines = await quiet(() => runFast(world([turn]).deps, run));
    const after = await state(run, "owner");
    assert.equal(after.run.status, "failed");
    assert.match(after.run.result!.error!, expected);
    assert.ok(!JSON.stringify([after, lines]).includes("UPSTREAM-BODY"), String(expected));
    await shared!.delete(schema.threads);
  }
  // A crash inside a tool is contained too: the model is told, the run goes on.
  const run = await begin("Read the slots");
  const broken = world([use("read_slots"), say("I could not read the site just now.")], { overlay: { ...overlayStore({}, fakeBlob().api), read: async () => { throw new Error("UPSTREAM-BODY blob down"); } } });
  const lines = await quiet(() => runFast(broken.deps, run));
  assert.equal(results(broken.seen, 1)[0].error, true);
  assert.equal((await state(run)).run.status, "done");
  assert.ok(!JSON.stringify([await state(run, "owner"), lines, broken.seen]).includes("UPSTREAM-BODY"));
});

test("follow-ups see the thread's earlier turns and the editor's context; privacy carries over to the reply", async () => {
  await fresh();
  const first = await begin("What is the wordmark?");
  await runFast(world([say("It reads Austin Chen.")]).deps, first);
  const hidden = await begin("PRIVATE aside", { threadId: first.threadId, hidden: true });
  await runFast(world([say("PRIVATE answer")]).deps, hidden);
  const third = await begin("Shorten this", { threadId: first.threadId, context: { route: "/", slot: "home.intro", text: "A long \"intro\"" } });
  const { deps, seen } = world([say("Which part should go?")], { env: { STUDIO_FAST_MODEL: "claude-opus-5-5" } });
  await runFast(deps, third);
  assert.equal(seen[0].model, "claude-opus-5-5");
  assert.deepEqual(seen[0].messages, [
    { role: "user", content: "What is the wordmark?" }, { role: "assistant", content: "It reads Austin Chen." },
    { role: "user", content: [{ type: "text", text: "Shorten this" }, { type: "text", text: "(Sent from the site's editor while pointing at page /, slot home.intro, the text \"A long \\\"intro\\\"\".)" }] },
  ]);
  const everyone = await getThread(shared!, "public", first.threadId), owner = await getThread(shared!, "owner", first.threadId);
  assert.deepEqual(everyone!.messages.map((message) => message.body), ["What is the wordmark?", "It reads Austin Chen.", "Shorten this", "Which part should go?"]);
  assert.deepEqual(owner!.messages.filter((message) => message.private).map((message) => [message.role, message.body]), [["owner", "PRIVATE aside"], ["claude", "PRIVATE answer"]]);
  assert.ok(!JSON.stringify(everyone).includes("PRIVATE"));
  // The private run itself saw the whole thread.
  const fourth = await begin("PRIVATE again", { threadId: first.threadId, hidden: true });
  const all = world([say("ok")]);
  await runFast(all.deps, fourth);
  assert.equal(all.seen[0].messages.length, 7);
});
