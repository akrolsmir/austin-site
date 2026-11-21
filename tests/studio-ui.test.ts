import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, bumpThread, contextLabel, mergeById, mergeThread, pollDelay, resultLine, routeOf, segments, shouldPoll, statusLabel, threadNote, took, type Held } from "../src/app/studio/logic";
import type { MessageView, RunView, ThreadResponse, ThreadSummary } from "../src/lib/studio/types";

const ID = "3f2b8c1e-0d4a-4b6f-9a7e-5c1d2e3f4a5b", OTHER = "9a7e5c1d-2e3f-4a5b-8c1e-0d4a4b6f3f2b";
const thread = (patch: Partial<ThreadSummary> = {}): ThreadSummary => ({ id: ID, title: "A thread", private: false, createdAt: "2026-11-21T10:00:00.000Z", updatedAt: "2026-11-21T10:00:00.000Z", status: null, ...patch });
const message = (id: string, createdAt: string, patch: Partial<MessageView> = {}): MessageView => ({ id, threadId: ID, role: "owner", body: id, private: false, createdAt, runId: null, ...patch });
const run = (id: string, patch: Partial<RunView> = {}): RunView => ({ id, threadId: ID, lane: "fast", status: "running", messageId: "m1", summary: null, result: null, stopRequested: false, createdAt: "2026-11-21T10:00:01.000Z", startedAt: null, endedAt: null, steps: [], can: { stop: true, revert: false, publish: false, discard: false }, ...patch });
const response = (patch: Partial<ThreadResponse> = {}): ThreadResponse => ({ configured: true, owner: false, thread: thread(), messages: [], runs: [], at: "2026-11-21T10:00:05.000Z", ...patch });

test("studio routes: the index, the composer, one thread, and everything else is missing", () => {
  assert.deepEqual(routeOf("/studio"), { view: "index" });
  assert.deepEqual(routeOf("/studio/"), { view: "index" });
  assert.deepEqual(routeOf("/studio/new"), { view: "new" });
  assert.deepEqual(routeOf(`/studio/${ID}`), { view: "thread", id: ID });
  for (const path of ["/studio/nope", `/studio/${ID.toUpperCase()}`, `/studio/${ID}/extra`, "/studio/../api", "/other"]) assert.deepEqual(routeOf(path), { view: "missing" }, path);
});

test("poll results merge by id: repeats replace, order stays oldest first, the cursor never goes back", () => {
  const first = mergeThread(null, response({ messages: [message("m2", "2026-11-21T10:00:02.000Z"), message("m1", "2026-11-21T10:00:00.000Z")], runs: [run("r1", { steps: [{ seq: 1, text: "Reading", state: "doing", at: "2026-11-21T10:00:01.000Z" }] })] }))!;
  assert.deepEqual(first.messages.map((entry) => entry.id), ["m1", "m2"]);
  const next = mergeThread(first, response({ thread: thread({ status: "done" }), at: "2026-11-21T10:00:09.000Z", messages: [message("m2", "2026-11-21T10:00:02.000Z", { body: "again" }), message("m3", "2026-11-21T10:00:08.000Z", { role: "claude" })], runs: [run("r1", { status: "done", steps: [{ seq: 1, text: "Reading", state: "done", at: "2026-11-21T10:00:01.000Z" }, { seq: 2, text: "Publishing", state: "done", at: "2026-11-21T10:00:07.000Z" }] })] }))!;
  assert.deepEqual(next.messages.map((entry) => entry.id), ["m1", "m2", "m3"]);
  assert.equal(next.messages[1].body, "again");
  assert.equal(next.runs.length, 1);
  assert.equal(next.runs[0].status, "done");
  assert.equal(next.runs[0].steps.length, 2);
  assert.equal(next.thread.status, "done");
  assert.equal(next.at, "2026-11-21T10:00:09.000Z");
  assert.equal(mergeThread(next, response({ at: "2026-11-21T10:00:03.000Z" }))!.at, "2026-11-21T10:00:09.000Z");
  // An empty poll changes nothing it holds; a "not configured" answer (no thread) is ignored.
  const held = mergeThread(next, response({ at: "2026-11-21T10:00:09.000Z" }))!;
  assert.equal(held.messages, next.messages);
  assert.equal(mergeThread(next, response({ thread: null })), next);
  // A response for a different thread starts over rather than mixing two conversations.
  const other = mergeThread(next, response({ thread: thread({ id: OTHER }), messages: [message("x1", "2026-11-21T09:00:00.000Z", { threadId: OTHER })] }))!;
  assert.deepEqual(other.messages.map((entry) => entry.id), ["x1"]);
  assert.deepEqual(mergeById([message("b", "2026-11-21T10:00:00.000Z"), message("a", "2026-11-21T10:00:00.000Z")], [message("a", "2026-11-21T10:00:00.000Z")]).map((entry) => entry.id), ["a", "b"]);
});

test("polling runs only while something in view is going, and backs off while requests fail", () => {
  const held = (status: RunView["status"]): Held => ({ thread: thread(), messages: [], runs: [run("r1", { status })], at: "" });
  assert.equal(shouldPoll(null, []), false);
  assert.equal(shouldPoll(held("queued"), []), true);
  assert.equal(shouldPoll(held("running"), []), true);
  for (const status of ["done", "failed", "stopped", "needs_publish", "reverted"] as const) assert.equal(shouldPoll(held(status), [thread({ status })]), false, status);
  assert.equal(shouldPoll(held("done"), [thread({ id: OTHER, status: "running" })]), true);
  assert.equal(shouldPoll(null, [thread({ status: null })]), false);
  assert.deepEqual([0, 1, 2, 3, 4, 99].map(pollDelay), [1500, 3000, 6000, 12000, 12000, 12000]);
  assert.deepEqual(bumpThread([thread({ id: OTHER }), thread()], thread({ status: "queued" })).map((entry) => [entry.id, entry.status]), [[ID, "queued"], [OTHER, null]]);
});

test("message text splits into text, inline code and safe links, and never loses a character", () => {
  const body = "See https://example.com/a_(b), then run `bun test`.\nAlso (https://example.com/x?y=1&z=2). Done!";
  const parts = segments(body);
  assert.equal(parts.map((part) => part.kind === "code" ? `\`${part.text}\`` : part.text).join(""), body);
  assert.deepEqual(parts.filter((part) => part.kind === "link").map((part) => part.kind === "link" && part.href), ["https://example.com/a_(b)", "https://example.com/x?y=1&z=2"]);
  assert.deepEqual(parts.filter((part) => part.kind === "code").map((part) => part.text), ["bun test"]);
  assert.deepEqual(segments("plain"), [{ kind: "text", text: "plain" }]);
  assert.deepEqual(segments(""), []);
  // Markup stays text, and only http(s) is ever linked.
  for (const hostile of ["<img src=x onerror=alert(1)>", "javascript:alert(1)", "[x](javascript:alert(1))", "data:text/html,<script>", "mailto:a@b.c", "//evil.example", "http://"]) assert.ok(segments(hostile).every((part) => part.kind !== "link"), hostile);
  const tricky = segments("https://example.com/\"onmouseover=\"x https://user:pw@example.com/<b>");
  assert.deepEqual(tricky.filter((part) => part.kind === "link").map((part) => part.kind === "link" && part.href), ["https://example.com/", "https://user:pw@example.com/"]);
  assert.deepEqual(segments("an unclosed ` tick\nand `` nothing else"), [{ kind: "text", text: "an unclosed ` tick\nand `` nothing else" }]);
  assert.deepEqual(segments("`https://example.com`"), [{ kind: "code", text: "https://example.com" }]);
});

test("times read the same on the server and the client: relative to a given now, dates in UTC", () => {
  const now = Date.parse("2026-11-21T12:00:00.000Z"), back = (ms: number) => new Date(now - ms).toISOString(), MIN = 60000;
  assert.equal(ago(back(20000), now), "just now");
  assert.equal(ago(back(-5000), now), "just now");
  assert.equal(ago(back(5 * MIN), now), "5 min ago");
  assert.equal(ago(back(3 * 60 * MIN), now), "3 h ago");
  assert.equal(ago(back(30 * 60 * MIN), now), "yesterday");
  assert.equal(ago(back(4 * 24 * 60 * MIN), now), "4 days ago");
  assert.equal(ago("2026-10-12T23:59:00.000Z", now), "Oct 12");
  assert.equal(ago("2025-12-31T00:00:00.000Z", now), "Dec 31, 2025");
  assert.equal(ago("not a date", now), "");
  assert.equal(took({ startedAt: null, endedAt: null }, now), "");
  assert.equal(took({ startedAt: back(4200), endedAt: null }, now), "4 s");
  assert.equal(took({ startedAt: back(90000), endedAt: back(10000) }, now), "1 min 20 s");
  assert.equal(took({ startedAt: back(120000), endedAt: now ? back(0) : null }, now), "2 min");
  assert.equal(took({ startedAt: back(2 * 3600000 + 5 * MIN), endedAt: back(0) }, now), "2 h 5 min");
});

test("run and thread wording covers every state", () => {
  assert.equal(statusLabel({ status: "running", stopRequested: true }), "Stopping");
  assert.equal(statusLabel({ status: "needs_publish", stopRequested: false }), "Ready to publish");
  assert.equal(threadNote(null), "");
  assert.equal(threadNote("done"), "");
  assert.equal(threadNote("running"), "Working");
  assert.equal(resultLine({ status: "failed", lane: "fast", summary: null, result: { error: "Claude declined this request." } }), "Claude declined this request.");
  assert.equal(resultLine({ status: "failed", lane: "fast", summary: null, result: null }), "This run failed.");
  assert.equal(resultLine({ status: "done", lane: "fast", summary: null, result: null }), "");
  assert.equal(resultLine({ status: "running", lane: "fast", summary: "ignored until it ends", result: null }), "");
  assert.match(resultLine({ status: "reverted", lane: "fast", summary: "Changed a thing.", result: null }), /^Reverted\./);
  assert.match(resultLine({ status: "reverted", lane: "code", summary: null, result: null }), /new commit/);
  assert.equal(resultLine({ status: "stopped", lane: "fast", summary: null, result: null }), "Stopped before finishing.");
  assert.deepEqual(contextLabel({ route: "/", slot: "home.intro", text: "  Hello\n there " }), { where: "home.intro on /", quote: "Hello there" });
  assert.deepEqual(contextLabel({ route: "/posts/a" }), { where: "/posts/a", quote: "" });
  assert.equal(contextLabel({ text: "x".repeat(200) }).quote.length, 80);
});
