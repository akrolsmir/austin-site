import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db";
import { CODE_RUNS_PER_DAY, MAX_QUEUED, STALE_ERROR, StudioLimit, activeRuns, addLog, addStep, claimNextRun, createThread, escalateRun, failStep, finishRun, getRun, getThread, history, listThreads, markReverted, noteResult, postMessage, queueIdle, reapStaleRuns, requestStop, startRun, stopRequested } from "../src/lib/studio/store";
import { askAllowed, decodeAsk, encodeAsk, isActive, parseContext, runActions, storable, threadTitle } from "../src/lib/studio/types";

// The studio's data functions against PGlite with the real schema (the same tables `bun run db:push` creates in Neon).
let shared: Db | undefined;
async function fresh(): Promise<Db> {
  if (!shared) { shared = drizzle(new PGlite(), { schema }) as unknown as Db; await (await pushSchema(schema, shared as never)).apply(); }
  await shared.delete(schema.threads);
  return shared;
}
const T0 = Date.parse("2026-11-21T10:00:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000);
async function ask(db: Db, body: string, { threadId, hidden = false, context, when = 0 }: { threadId?: string; hidden?: boolean; context?: schema.MessageContext; when?: number } = {}) {
  const thread = threadId ?? (await createThread(db, { body, private: hidden, now: at(when) })).id;
  const message = (await postMessage(db, { threadId: thread, role: "owner", body, private: hidden, context, now: at(when) }))!;
  const run = await startRun(db, { threadId: thread, messageId: message.id, now: at(when) });
  return { threadId: thread, message, run };
}

test("a public viewer never receives private threads, private messages, context, a private message's run, or logs", async () => {
  const db = await fresh();
  const open = await ask(db, "Rename the writing heading to Essays", { context: { route: "/", slot: "home.writing.heading", text: "CONTEXT-SECRET" } });
  await addStep(db, open.run.id, "Reading the homepage", { now: at(1) });
  await addLog(db, open.run.id, "LOG-SECRET tool input", at(1));
  await postMessage(db, { threadId: open.threadId, role: "claude", body: "Renamed it.", runId: open.run.id, now: at(2) });
  const aside = await ask(db, "MESSAGE-SECRET note to self", { threadId: open.threadId, hidden: true, when: 3 });
  await addStep(db, aside.run.id, "STEP-SECRET", { now: at(4) });
  await finishRun(db, aside.run.id, { status: "failed", result: { error: "RESULT-SECRET" }, now: at(5) });
  const closed = await ask(db, "THREAD-SECRET plan", { hidden: true, when: 6 });
  await postMessage(db, { threadId: closed.threadId, role: "claude", body: "REPLY-SECRET", runId: closed.run.id, now: at(7) });

  const list = await listThreads(db, "public"), detail = await getThread(db, "public", open.threadId);
  assert.deepEqual(list.map((thread) => thread.id), [open.threadId]);
  assert.equal(list[0].status, "queued"); // the newest run the public may see, not the private one that failed
  assert.equal(await getThread(db, "public", closed.threadId), null);
  assert.equal(await getThread(db, "public", closed.threadId, { after: at(0) }), null);
  assert.deepEqual(detail!.messages.map((message) => message.body), ["Rename the writing heading to Essays", "Renamed it."]);
  assert.ok(detail!.messages.every((message) => !("context" in message)));
  assert.deepEqual(detail!.runs.map((run) => run.id), [open.run.id]);
  assert.ok(detail!.runs.every((run) => !("logs" in run)));
  assert.deepEqual(detail!.runs[0].steps.map((step) => step.text), ["Reading the homepage"]);
  const everything = JSON.stringify([list, detail, await getThread(db, "public", open.threadId, { after: at(0) })]);
  for (const secret of ["CONTEXT-SECRET", "LOG-SECRET", "MESSAGE-SECRET", "STEP-SECRET", "RESULT-SECRET", "THREAD-SECRET", "REPLY-SECRET", aside.run.id, closed.threadId]) assert.ok(!everything.includes(secret), secret);

  const mine = await getThread(db, "owner", open.threadId);
  assert.deepEqual((await listThreads(db, "owner")).map((thread) => [thread.id, thread.private, thread.status]), [[closed.threadId, true, "queued"], [open.threadId, false, "failed"]]);
  assert.equal(mine!.messages.length, 3);
  assert.deepEqual(mine!.messages[0].context, { route: "/", slot: "home.writing.heading", text: "CONTEXT-SECRET" });
  assert.equal(mine!.messages[0].runId, open.run.id); // an owner message points at the run it started
  assert.deepEqual(mine!.runs.map((run) => run.id), [open.run.id, aside.run.id]);
  assert.deepEqual(mine!.runs[0].logs!.map((log) => log.text), ["LOG-SECRET tool input"]);
  // Everything in a private thread is private, whatever the message said; a private message leaves a public thread's updatedAt alone.
  assert.ok((await getThread(db, "owner", closed.threadId))!.messages.every((message) => message.private));
  assert.equal(mine!.thread.updatedAt, at(2).toISOString());
  assert.equal(await postMessage(db, { threadId: "missing", role: "owner", body: "x" }), null);
});

test("one run at a time: later requests queue and are claimed oldest first, atomically", async () => {
  const db = await fresh();
  const first = await ask(db, "one", { when: 0 }), second = await ask(db, "two", { when: 1 }), third = await ask(db, "three", { threadId: first.threadId, when: 2 });
  assert.deepEqual([first, second, third].map(({ run }) => run.status), ["queued", "queued", "queued"]);
  assert.equal(await queueIdle(db), true);
  const claims = await Promise.all([claimNextRun(db, at(3)), claimNextRun(db, at(3)), claimNextRun(db, at(3))]);
  assert.deepEqual(claims.filter(Boolean).map((run) => run!.id), [first.run.id]);
  assert.equal(claims.find(Boolean)!.status, "running");
  assert.equal(claims.find(Boolean)!.startedAt!.getTime(), at(3).getTime());
  assert.equal(await claimNextRun(db, at(4)), null); // one is running
  assert.equal(await queueIdle(db), false);
  await finishRun(db, first.run.id, { status: "done", now: at(5) });
  assert.equal(await queueIdle(db), true);
  assert.equal((await claimNextRun(db, at(6)))!.id, second.run.id);
  await finishRun(db, second.run.id, { status: "failed", result: { error: "nope" }, now: at(7) });
  assert.equal((await claimNextRun(db, at(8)))!.id, third.run.id);
  await finishRun(db, third.run.id, { status: "stopped", now: at(9) });
  assert.equal(await claimNextRun(db, at(10)), null);
  assert.equal(await queueIdle(db), false);
  // A run waiting at needs_publish is not "running": the queue moves on.
  const fourth = await ask(db, "four", { when: 11 }), fifth = await ask(db, "five", { when: 12 });
  await claimNextRun(db, at(13));
  assert.equal((await finishRun(db, fourth.run.id, { status: "needs_publish", now: at(14) }))!.endedAt, null);
  assert.equal((await claimNextRun(db, at(15)))!.id, fifth.run.id);
});

test("caps: a bounded queue, and 30 code-lane runs per rolling 24 hours", async () => {
  const db = await fresh();
  const { threadId, message } = await ask(db, "first");
  for (let i = 1; i < MAX_QUEUED; i++) await startRun(db, { threadId, messageId: message.id, now: at(i) });
  await assert.rejects(startRun(db, { threadId, messageId: message.id, now: at(99) }), StudioLimit);
  await db.delete(schema.runs);

  const hour = 3600, code = (when: number) => db.insert(schema.runs).values({ id: crypto.randomUUID(), threadId, messageId: message.id, lane: "code", status: "done", createdAt: at(when) });
  for (let i = 0; i < CODE_RUNS_PER_DAY; i++) await code(i * 60); // one a minute for the first half hour
  const fast = await startRun(db, { threadId, messageId: message.id, now: at(hour) }); // the fast lane is not capped
  await claimNextRun(db, at(hour));
  await assert.rejects(startRun(db, { threadId, messageId: message.id, lane: "code", now: at(hour) }), /limit for today/);
  assert.equal(await escalateRun(db, fast.id, at(hour)), null);
  assert.equal((await getRun(db, fast.id))!.lane, "fast");
  // 24 hours after the oldest one, a slot is free again.
  assert.equal(await escalateRun(db, fast.id, at(24 * hour - 1)), null);
  const moved = await escalateRun(db, fast.id, at(24 * hour + 1));
  assert.equal(moved!.lane, "code");
  assert.equal(moved!.status, "running");
  assert.equal(await escalateRun(db, fast.id, at(24 * hour + 2)), null); // only a fast-lane run escalates
});

test("the reaper fails runs that went silent (fast lane 6 minutes, code lane 15), never one waiting on its preview", async () => {
  const db = await fresh();
  const dead = await ask(db, "dead"), waiting = await ask(db, "waiting", { when: 1 });
  await claimNextRun(db, at(2));
  await addStep(db, dead.run.id, "Reading the homepage", { now: at(3) });
  await noteResult(db, dead.run.id, { overlayHash: "0123456789abcdef" }, at(4));
  assert.deepEqual(await reapStaleRuns(db, at(4 + 6 * 60)), []); // exactly 6 minutes is not yet stale
  assert.deepEqual(await reapStaleRuns(db, at(5 + 6 * 60)), [dead.run.id]);
  const reaped = (await getThread(db, "owner", dead.threadId))!.runs[0];
  assert.equal(reaped.status, "failed");
  assert.deepEqual(reaped.result, { overlayHash: "0123456789abcdef", error: STALE_ERROR });
  assert.equal(reaped.endedAt, at(5 + 6 * 60).toISOString());
  assert.deepEqual(reaped.steps.map((step) => step.state), ["failed"]);
  assert.deepEqual(reaped.can, { stop: false, revert: true, publish: false, discard: false }); // what it published can still be reverted
  assert.equal((await getRun(db, waiting.run.id))!.status, "queued"); // queued runs do not go stale
  assert.equal(await queueIdle(db), true);
  assert.equal((await claimNextRun(db, at(1000)))!.id, waiting.run.id);
  await addStep(db, waiting.run.id, "Still going", { now: at(1000 + 5 * 60) }); // any step is a heartbeat
  assert.deepEqual(await reapStaleRuns(db, at(1000 + 10 * 60)), []);
  assert.equal(await finishRun(db, dead.run.id, { status: "done", now: at(2000) }), null); // a late finish cannot undo the reap
  // In the code lane a runner may be silent for minutes (the checks block it), so it gets 15.
  assert.ok(await escalateRun(db, waiting.run.id, at(3000)));
  assert.deepEqual(await reapStaleRuns(db, at(3000 + 15 * 60)), []);
  // Once its pull request is open and the runner is gone, only the code lane's sweep ends it: the reaper never does.
  await noteResult(db, waiting.run.id, { prNumber: 7 }, at(3000));
  assert.deepEqual(await reapStaleRuns(db, at(3000 + 60 * 60)), []);
  assert.deepEqual((await activeRuns(db)).map((run) => [run.status, run.lane]), [["running", "code"]]);
  await db.update(schema.runs).set({ result: null }).where(eq(schema.runs.id, waiting.run.id));
  assert.deepEqual(await reapStaleRuns(db, at(3000 + 60 * 60)), [waiting.run.id]);
});

test("steps, results, stop, finish, and revert move a run through its states", async () => {
  const db = await fresh();
  const { run, threadId } = await ask(db, "go"), other = await ask(db, "later", { when: 1 });
  assert.equal((await requestStop(db, other.run.id, at(2)))!.status, "stopped"); // queued: stops at once
  assert.equal(await requestStop(db, "missing", at(2)), null);
  await claimNextRun(db, at(3));
  await addStep(db, run.id, "Reading the site's editable values", { now: at(4) });
  await addStep(db, run.id, "Publishing 2 changes", { now: at(5) });
  await failStep(db, run.id, at(6));
  await addStep(db, run.id, "Publishing 2 changes", { now: at(7) });
  await noteResult(db, run.id, { overlayHash: "aaaaaaaaaaaaaaaa", previousOverlayHash: "bbbbbbbbbbbbbbbb" }, at(8));
  await noteResult(db, run.id, { overlayHash: "cccccccccccccccc" }, at(9));
  assert.equal(await stopRequested(db, run.id), false);
  const flagged = await requestStop(db, run.id, at(10));
  assert.deepEqual([flagged!.status, flagged!.stopRequested, await stopRequested(db, run.id)], ["running", true, true]);
  const done = await finishRun(db, run.id, { status: "done", summary: "Renamed two headings", now: at(11) });
  assert.deepEqual(done!.result, { overlayHash: "cccccccccccccccc", previousOverlayHash: "bbbbbbbbbbbbbbbb" });
  assert.equal((await requestStop(db, run.id, at(12)))!.status, "done"); // already ended: returned as is
  const view = (await getThread(db, "public", threadId))!.runs[0];
  assert.deepEqual(view.steps.map((step) => [step.seq, step.text, step.state]), [[1, "Reading the site's editable values", "done"], [2, "Publishing 2 changes", "failed"], [3, "Publishing 2 changes", "done"]]);
  assert.deepEqual([view.status, view.summary, view.stopRequested, view.endedAt], ["done", "Renamed two headings", false, at(11).toISOString()]);
  assert.deepEqual(view.can, { stop: false, revert: true, publish: false, discard: false });
  assert.equal((await markReverted(db, run.id, { now: at(13) }))!.status, "reverted");
  assert.equal(await markReverted(db, run.id), null);
  const active = await ask(db, "again", { when: 14 });
  assert.equal(await markReverted(db, active.run.id), null); // only a run that has ended can be reverted
});

test("?after polling returns only the messages and runs touched since", async () => {
  const db = await fresh();
  const first = await ask(db, "one", { when: 0 });
  await claimNextRun(db, at(1));
  await finishRun(db, first.run.id, { status: "done", now: at(2) });
  const second = await ask(db, "two", { threadId: first.threadId, when: 10 });
  const since = await getThread(db, "public", first.threadId, { after: at(5) });
  assert.deepEqual(since!.messages.map((message) => message.body), ["two"]);
  assert.deepEqual(since!.runs.map((run) => run.id), [second.run.id]);
  assert.equal(since!.thread.status, "queued");
  await claimNextRun(db, at(11));
  await addStep(db, second.run.id, "Reading the homepage", { now: at(20) });
  const later = await getThread(db, "public", first.threadId, { after: at(20) });
  assert.deepEqual(later!.messages, []);
  assert.deepEqual(later!.runs.map((run) => [run.id, run.steps.length]), [[second.run.id, 1]]); // a touched run comes back whole
  const quiet = await getThread(db, "public", first.threadId, { after: at(21) });
  assert.deepEqual([quiet!.messages, quiet!.runs], [[], []]);
});

test("history is the conversation up to the run's message, without private turns unless the run is private", async () => {
  const db = await fresh();
  const first = await ask(db, "public one", { when: 0 });
  await postMessage(db, { threadId: first.threadId, role: "claude", body: "public reply", now: at(1) });
  const hidden = await ask(db, "private two", { threadId: first.threadId, hidden: true, when: 2 });
  const third = await ask(db, "public three", { threadId: first.threadId, when: 3 });
  await ask(db, "public four", { threadId: first.threadId, when: 4 });
  assert.deepEqual((await history(db, third.run)).map((row) => row.body), ["public one", "public reply", "public three"]);
  assert.deepEqual((await history(db, hidden.run)).map((row) => row.body), ["public one", "public reply", "private two"]);
  assert.deepEqual(await history(db, { threadId: first.threadId, messageId: "missing" }), []);
  const deleted = await db.delete(schema.threads).where(eq(schema.threads.id, first.threadId)).returning();
  assert.equal(deleted.length, 1);
  assert.equal(await getRun(db, third.run.id), undefined); // rows cascade with their thread
});

test("?ask= is taken only from a same-origin navigation; text must be storable", () => {
  const from = (headers: Record<string, string>) => askAllowed(new Headers(headers));
  assert.deepEqual([from({ "sec-fetch-site": "same-origin" }), from({ "sec-fetch-site": "cross-site" }), from({ "sec-fetch-site": "same-site" }), from({ "sec-fetch-site": "none" })], [true, false, false, false]);
  assert.equal(from({ "sec-fetch-site": "cross-site", referer: "https://austin.site/", host: "austin.site" }), false); // the browser's word beats the Referer
  assert.deepEqual([from({ referer: "https://austin.site/posts", host: "austin.site" }), from({ referer: "https://evil.example/", host: "austin.site" }), from({ host: "austin.site" }), from({})], [true, false, false, false]);
  assert.equal(from({ referer: "https://austin.site/", host: "internal:3000", "x-forwarded-host": "austin.site" }), true);
  assert.deepEqual([storable("fine 😀"), storable("half \ud83d"), storable("\udc00 half"), storable("nul\u0000")], [true, false, false, false]);
  assert.equal(parseContext({ route: "/", text: "half \ud83d" }), null);
});

test("pure helpers: titles, run actions, and the strict ?ask= decoder", () => {
  assert.equal(threadTitle("  Rename the\n writing   heading "), "Rename the writing heading");
  assert.equal(threadTitle(""), "Untitled");
  const long = threadTitle("Please change the homepage intro so that it mentions the new essay about gardens and the photos from Lisbon");
  assert.ok(long.length <= 61 && long.endsWith("…") && !/\s…$/.test(long), long);
  assert.equal(threadTitle("x".repeat(200)).length, 61);
  assert.deepEqual([isActive("queued"), isActive("running"), isActive("needs_publish"), isActive("done")], [true, true, false, false]);
  assert.deepEqual(runActions({ lane: "fast", status: "done", result: null }), { stop: false, revert: false, publish: false, discard: false });
  assert.deepEqual(runActions({ lane: "fast", status: "running", result: { overlayHash: "a" } }), { stop: true, revert: false, publish: false, discard: false });
  assert.deepEqual(runActions({ lane: "fast", status: "reverted", result: { overlayHash: "a" } }), { stop: false, revert: false, publish: false, discard: false });
  assert.deepEqual(runActions({ lane: "code", status: "needs_publish", result: {} }), { stop: false, revert: false, publish: true, discard: true });
  assert.deepEqual(runActions({ lane: "code", status: "done", result: { mergeSha: "abc" } }), { stop: false, revert: true, publish: false, discard: false });

  const context = { route: "/posts/a-guide?x=1", slot: "home.intro", text: "Héllo “world”\nsecond line" };
  assert.deepEqual(decodeAsk(encodeAsk(context)), context);
  assert.deepEqual(decodeAsk(encodeAsk({ route: "/" })), { route: "/" });
  assert.doesNotMatch(encodeAsk(context), /[+/=]/);
  const raw = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
  for (const bad of [
    undefined, null, 7, "", "not base64!", raw("{not json"), raw([]), raw("\"/\""), raw({}), raw({ slot: "home.intro" }), raw({ route: "/", extra: 1 }), raw({ route: "/", selector: "main > h1" }),
    raw({ route: "https://evil.example/" }), raw({ route: "//evil.example" }), raw({ route: "/\\evil.example" }), raw({ route: "javascript:alert(1)" }), raw({ route: "posts" }), raw({ route: "/a b" }), raw({ route: `/${"a".repeat(300)}` }),
    raw({ route: 5 }), raw({ route: "/", slot: "Home.Intro" }), raw({ route: "/", slot: "home..intro" }), raw({ route: "/", slot: "" }), raw({ route: "/", text: 5 }), raw({ route: "/", text: "x".repeat(501) }), raw({ route: "/", text: "a\u0000b" }), raw({ route: "/", text: "a\u001bb" }),
    Buffer.from([0x7b, 0xff, 0x7d]).toString("base64url"), "A".repeat(4001),
  ]) assert.equal(decodeAsk(bad), null, String(bad));
  assert.deepEqual(parseContext({ route: "/", selector: "main > h1" }), { route: "/", selector: "main > h1" });
  assert.equal(parseContext(undefined), undefined);
  assert.equal(parseContext({}), undefined);
  assert.equal(parseContext("x"), null);
  assert.equal(parseContext({ selector: "a\nb" }), null);
});
