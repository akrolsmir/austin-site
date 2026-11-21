import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db";
import { studioHandlers } from "../src/app/api/studio/handlers";
import type { OverlayStore } from "../src/lib/overlay";
import { AUTO_MERGE_PATHS, CODE_LANE_UNAVAILABLE, LEASE_MS, NO_BUILD, NO_BUILD_MS, discardCodeRun, MAX_FILES, MAX_FILE_BYTES, PREVIEW_MAX_MS, STOP_GRACE_MS, branchName, codeSweepDue, globMatch, guardedPaths, hashToken, parseResult, publishCodeRun, revertCodeRun, runnerEvent, safePath, sandboxName, startCodeRun, sweepCodeRuns, type CodeDeps } from "../src/lib/studio/code";
import { github } from "../src/lib/studio/github";
import { TooBig, type Box, type SandboxClient } from "../src/lib/studio/sandbox";
import { CODE_RUNS_PER_DAY, StudioLimit, claimNextRun, createThread, getRun, getThread, postMessage, requestStop, startRun } from "../src/lib/studio/store";

// The code lane against PGlite, a fake sandbox, a fake GitHub (fetch), and a clock the test moves: starting a run, the
// runner's token, the finish through merge, guarded paths, failures, refusals, stop, revert, and the caps. Nothing here
// reaches Vercel, GitHub, or Anthropic; what that leaves unverified is listed in the code lane's report.
let shared: Db | undefined;
async function fresh(): Promise<Db> {
  if (!shared) { shared = drizzle(new PGlite(), { schema }) as unknown as Db; await (await pushSchema(schema, shared as never)).apply(); }
  await shared.delete(schema.threads);
  return shared;
}
const T0 = Date.parse("2026-11-21T10:00:00.000Z");
const SECRETS = { GITHUB_TOKEN: "ghp_GITHUB-SECRET", DATABASE_URL: "postgres://DATABASE-SECRET", BLOB_READ_WRITE_TOKEN: "BLOB-SECRET", BETTER_AUTH_SECRET: "AUTH-SECRET", GITHUB_CLIENT_SECRET: "OAUTH-SECRET", CRON_SECRET: "CRON-SECRET", NOTION_TOKEN: "NOTION-SECRET" };
const ENV = { ...SECRETS, ANTHROPIC_API_KEY: "sk-ant-MODEL-KEY-0123456789", VERCEL_GIT_COMMIT_SHA: "d".repeat(40), STUDIO_CODE_MODEL: "claude-test" };
const TOKEN = `tok_${"a".repeat(40)}`, BASE = "b".repeat(40), HEAD = "c".repeat(40), MERGED = "e".repeat(40), REVERTED = "f".repeat(40);
const API = "/repos/akrolsmir/austin-site";

function fakeSandbox() {
  const state = { created: [] as Array<{ name: string; repo: string; revision: string; timeoutMs: number }>, commands: [] as Array<{ cmd: string; args: string[]; env?: Record<string, string>; detached?: boolean }>, written: [] as Array<{ path: string; content: string }>, files: new Map<string, Buffer>(), index: new Map<string, string>(), stopped: 0, failCreate: false, setupExit: 0 };
  const box: Box = {
    name: "",
    async run(cmd, args, options) {
      state.commands.push({ cmd, args, env: options?.env, detached: options?.detached });
      if (cmd === "git") return { exitCode: 0, output: [...state.index].map(([path, mode]) => `${mode} ${"0".repeat(40)} 0\t${path}\0`).join("") };
      return { exitCode: options?.detached ? null : state.setupExit, output: "setup output" };
    },
    async read(path, max) { const file = state.files.get(path.replace("/vercel/sandbox/", "")); if (file && file.length > max) throw new TooBig(); return file ?? null; },
    async write(files) { state.written.push(...files); },
    async stop() { state.stopped++; },
  };
  const client: SandboxClient = {
    async create(options) { if (state.failCreate) throw new Error("no capacity"); state.created.push(options); box.name = options.name; return box; },
    async get(name) { return state.created.some((made) => made.name === name) ? box : null; },
  };
  const put = (path: string, content: string | Buffer, mode = "100644") => { state.files.set(path, Buffer.from(content)); state.index.set(path, mode); };
  return { state, client, put };
}
function fakeGitHub(clock: () => number) {
  type Pr = { number: number; html_url: string; title: string; body: string; state: string; merged: boolean; merge_commit_sha: string | null; created_at: string; node_id: string; head: { sha: string; ref: string } };
  const state = { calls: [] as Array<{ method: string; path: string; body?: Record<string, unknown>; auth: string | null }>, onMain: true, preview: (() => "success") as () => string, mergeFailures: 0, prs: new Map<number, Pr>(), refs: [] as string[], blobs: [] as string[], commits: [] as Array<Record<string, unknown>>, trees: [] as Array<Record<string, unknown>>, deleted: [] as string[] };
  const reply = (data: unknown, status = 200) => new Response(data === null ? null : JSON.stringify(data), { status });
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input)), method = init.method ?? "GET", path = url.pathname.replace(API, ""), body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    assert.equal(url.origin, "https://api.github.com");
    state.calls.push({ method, path: path + url.search, body, auth: new Headers(init.headers).get("authorization") });
    const pull = /^\/pulls\/(\d+)(\/merge)?$/.exec(path);
    if (method === "GET" && path.startsWith("/compare/")) return reply({ status: state.onMain ? "identical" : "diverged" });
    if (method === "GET" && path.startsWith("/git/commits/")) return reply({ tree: { sha: "tree-of-base" } });
    if (method === "POST" && path === "/git/blobs") { state.blobs.push(Buffer.from(String(body!.content), "base64").toString()); return reply({ sha: `blob${state.blobs.length}` }, 201); }
    if (method === "POST" && path === "/git/trees") { state.trees.push(body!); return reply({ sha: "tree-new" }, 201); }
    if (method === "POST" && path === "/git/commits") { state.commits.push(body!); return reply({ sha: HEAD }, 201); }
    if (method === "POST" && path === "/git/refs") { if (state.refs.includes(String(body!.ref))) return reply({ message: "Reference already exists" }, 422); state.refs.push(String(body!.ref)); return reply({}, 201); }
    if (method === "DELETE" && path.startsWith("/git/refs/heads/")) { state.deleted.push(path.slice("/git/refs/heads/".length)); return reply(null, 204); }
    if (method === "POST" && path === "/pulls") {
      const pr: Pr = { number: 7, html_url: "https://github.com/akrolsmir/austin-site/pull/7", title: String(body!.title), body: String(body!.body), state: "open", merged: false, merge_commit_sha: null, created_at: new Date(clock()).toISOString(), node_id: "PR_node7", head: { sha: HEAD, ref: String(body!.head) } };
      state.prs.set(7, pr);
      return reply(pr, 201);
    }
    if (method === "GET" && pull && !pull[2]) { const pr = state.prs.get(Number(pull[1])); return pr ? reply(pr) : reply({ message: "Not Found" }, 404); }
    if (method === "PATCH" && pull && !pull[2]) { const pr = state.prs.get(Number(pull[1]))!; pr.state = String(body!.state); return reply(pr); }
    if (method === "PUT" && pull?.[2]) {
      const pr = state.prs.get(Number(pull[1]))!;
      if (state.mergeFailures-- > 0) return reply({ message: "SECRET-RESPONSE-BODY not mergeable" }, 405);
      Object.assign(pr, { state: "closed", merged: true, merge_commit_sha: pr.number === 7 ? MERGED : REVERTED });
      return reply({ sha: pr.merge_commit_sha, merged: true });
    }
    if (method === "GET" && path === "/deployments") return reply(state.preview() === "none" ? [] : [{ id: 1 }]);
    if (method === "GET" && path === "/deployments/1/statuses") return reply([{ state: state.preview(), environment_url: "https://austin-site-git-studio.vercel.app" }]);
    if (method === "POST" && url.pathname === "/graphql") {
      state.prs.set(8, { number: 8, html_url: "https://github.com/akrolsmir/austin-site/pull/8", title: "Revert", body: "", state: "open", merged: false, merge_commit_sha: null, created_at: new Date(clock()).toISOString(), node_id: "PR_node8", head: { sha: "9".repeat(40), ref: "revert-7-studio" } });
      return reply({ data: { revertPullRequest: { revertPullRequest: { number: 8, url: "https://github.com/akrolsmir/austin-site/pull/8", headRefOid: "9".repeat(40), headRefName: "revert-7-studio" } } } });
    }
    return reply({ message: "Not Found" }, 404);
  }) as typeof fetch;
  const writes = () => state.calls.filter((call) => call.method !== "GET");
  return { state, fetch: fetchImpl, writes };
}
// One site: a db, a sandbox, GitHub, and a clock that `sleep` (the lane's only way to wait) and the test both move.
async function world(env: Record<string, string | undefined> = ENV) {
  const db = await fresh(), sandbox = fakeSandbox(), time = { t: T0 }, gh = fakeGitHub(() => time.t);
  const overlay = { read: async () => ({ overlay: { "site.wordmark": "Austin's site", "bogus.slot": "dropped", "theme.ink": "not a colour" }, head: { current: "h", history: [] } }) } as unknown as OverlayStore;
  const deps: CodeDeps = { db, env, fetch: gh.fetch, now: () => new Date(time.t), origin: "https://austin.site", sandbox: sandbox.client, overlay, token: () => TOKEN, sleep: async (ms) => { time.t += ms; } };
  async function begin(body = "Add a guestbook page", { hidden = false, start = true }: { hidden?: boolean; start?: boolean } = {}) {
    const thread = await createThread(db, { body, private: hidden, now: new Date(time.t) });
    await postMessage(db, { threadId: thread.id, role: "owner", body: "Earlier question", private: hidden, now: new Date(time.t) });
    await postMessage(db, { threadId: thread.id, role: "claude", body: "Earlier answer", private: hidden, now: new Date(time.t) });
    const message = (await postMessage(db, { threadId: thread.id, role: "owner", body, private: hidden, context: { route: "/", slot: "home.intro" }, now: new Date(time.t) }))!;
    const run = await startRun(db, { threadId: thread.id, messageId: message.id, lane: "code", now: new Date(time.t) });
    assert.equal((await claimNextRun(db, new Date(time.t)))?.id, run.id);
    if (start) assert.deepEqual(await startCodeRun(deps, run, "Add /guestbook with a form."), { ok: true });
    return run;
  }
  const event = (runId: string, token: string | null, type: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}, with_: CodeDeps = deps) => runnerEvent(with_, new Request("https://austin.site/api/studio/runner", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify({ run: runId, type, ...extra }) }));
  const row = async (runId: string) => (await getRun(db, runId))!;
  const view = async (runId: string, threadId: string) => { const detail = (await getThread(db, "owner", threadId))!; return { run: detail.runs.find((run) => run.id === runId)!, messages: detail.messages }; };
  return { db, deps, sandbox, gh, time, begin, event, row, view };
}
const changes = (files: Array<{ path: string; mode: string | null }>, extra: Record<string, unknown> = {}) => ({ outcome: "changes", base: BASE, files, title: "Add a guestbook page", summary: "There is now a guestbook at /guestbook.", details: "Used a slot for the heading. <!-- hidden --> cc @someone", checksPassed: true, ...extra });
const PAGE = [{ path: "src/app/guestbook/guestbook.css", mode: "100644" }, { path: "src/site/content.json", mode: "100644" }, { path: "src/app/old.css", mode: null }];
const stage = (sandbox: ReturnType<typeof fakeSandbox>) => { sandbox.put("src/app/guestbook/guestbook.css", ".guestbook { color: var(--ink); }\n"); sandbox.put("src/site/content.json", "{}\n"); };

test("globs, guarded paths, and path safety", () => {
  assert.ok(globMatch("src/app/api/**", "src/app/api/studio/runner/route.ts"));
  assert.ok(globMatch("src/lib/*.ts", "src/lib/auth.ts"));
  assert.ok(!globMatch("src/lib/*.ts", "src/lib/studio/code.ts")); // `*` stays inside one directory
  assert.ok(!globMatch("package.json", "packageXjson")); // dots are literal
  assert.ok(!globMatch("package.json", "docs/package.json")); // anchored at the repo root
  assert.ok(!globMatch("src/db/**", "src/dbx/schema.ts"));
  // Only data and stylesheets merge by themselves. Everything else waits for Publish, including every file nobody listed:
  // anything that runs on the server, at build time, or in the owner's browser.
  assert.deepEqual(guardedPaths(["src/site/content.json", "src/site/theme.json", "src/app/globals.css", "src/app/studio/studio.css", "src/editor/editor.css"]), []);
  const guarded = [
    "src/lib/auth.ts", "src/app/sign-in/page.tsx", "src/lib/studio/code.ts", "scripts/studio-runner.ts", "src/app/api/overlay/route.ts", "src/lib/sync.ts", "src/lib/notion-client.ts", "vercel.json", "next.config.ts", "package.json", "bun.lock", "src/db/schema.ts", "docs/editable-site.md", "CLAUDE.md", ".claude/settings.json", ".github/workflows/ci.yml",
    "next.config.js", "next.config.mjs", "src/instrumentation.ts", "src/instrumentation-client.ts", "instrumentation.ts", "src/proxy.js", "src/middleware.js", "middleware.ts", "src/app/x/route.ts", "src/app/x/route.js", "tsconfig.json", "postcss.config.mjs", "eslint.config.mjs", "bunfig.toml", ".npmrc", ".nvmrc", ".vercelignore", ".gitignore",
    "src/lib/overlay.ts", "src/lib/types.ts", "src/lib/posts.ts", "src/lib/jpeg.ts", "src/site/schema.ts", "src/site/index.ts", "src/site/e.tsx", "src/editor/index.ts", "src/editor/app.tsx", "src/components/editor-loader.tsx", "src/app/layout.tsx", "src/app/page.tsx", "src/app/studio/studio.tsx", "src/components/prose.tsx", "scripts/sync.ts", "tests/site.test.ts",
    "public/x.html", "data/posts/a.md", "src/lib/photos.json", "src/site/content.json.ts", "src/app/globals.css.ts", "src/site/theme.jsonx", "xsrc/site/content.json", "src/lib/x.css", "some-new-file-nobody-thought-of",
  ];
  assert.deepEqual(guardedPaths(guarded), guarded);
  assert.equal(AUTO_MERGE_PATHS.length, 4);
  for (const path of ["src/app/page.tsx", "a/b.c/d", ".gitignore", "public/.well-known/x"]) assert.ok(safePath(path), path);
  for (const path of ["", "/etc/passwd", "../outside", "src/../../outside", "src/./x", "src//x", ".git/config", ".env", ".env.local", "apps/.env.production", ".ENV", "a\\b", "a\u0000b", "a\nb", "x".repeat(301), 7, null]) assert.ok(!safePath(path), String(path));
});

test("a runner's result is parsed strictly, and paths that may not ship are refused in plain words", () => {
  assert.deepEqual(parseResult({ outcome: "answered", summary: " Nothing to change. " }), { outcome: "answered", summary: "Nothing to change." });
  assert.deepEqual(parseResult({ outcome: "failed", error: "x".repeat(900) }), { outcome: "failed", error: "x".repeat(300) });
  assert.deepEqual(parseResult({ outcome: "stopped", files: "ignored" }), { outcome: "stopped" });
  assert.deepEqual(parseResult(changes([{ path: "a.ts", mode: "100755" }], { checksPassed: "yes", title: "T\nitle" })), { outcome: "changes", base: BASE, files: [{ path: "a.ts", mode: "100755" }], title: "T itle", summary: "There is now a guestbook at /guestbook.", details: "Used a slot for the heading. <!-- hidden --> cc @someone", checksPassed: false });
  for (const bad of [null, "changes", {}, { outcome: "merged" }, changes([]), changes([{ path: "a.ts", mode: "100644" }], { base: "main" }), changes([{ path: "a.ts", mode: "100644" }, { path: "a.ts", mode: null }]), changes([{ mode: "100644" } as never])]) assert.equal(parseResult(bad), null);
  for (const path of [".env.local", "../up", ".git/hooks/pre-commit", "/etc/passwd"]) assert.throws(() => parseResult(changes([{ path, mode: "100644" }])), /cannot be shipped from the studio/);
  assert.throws(() => parseResult(changes([{ path: "link", mode: "120000" }])), /symlink/);
  assert.throws(() => parseResult(changes([{ path: "vendor", mode: "160000" }])), /symlink or another special file/);
  assert.throws(() => parseResult(changes(Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ path: `f${i}`, mode: "100644" })))), /too many/);
});

test("starting a run gives the sandbox the model key and its own token, and nothing else that is secret", async () => {
  const { db, sandbox, begin, row, view } = await world();
  const run = await begin();
  assert.deepEqual(sandbox.state.created, [{ name: sandboxName(run.id), repo: "akrolsmir/austin-site", revision: "main", timeoutMs: 40 * 60 * 1000 }]);
  const [setup, runner] = sandbox.state.commands;
  assert.equal(sandbox.state.commands.length, 2);
  assert.equal(setup.env, undefined);
  assert.match(setup.args[1], new RegExp(`git fetch -q --depth=1 origin ${"d".repeat(40)}; git archive FETCH_HEAD scripts/studio-runner.ts`)); // the runner of the deployed commit
  assert.ok(runner.detached);
  assert.match(runner.args[1], /bun \/tmp\/studio-runner\/scripts\/studio-runner\.ts/);
  assert.deepEqual(runner.env, { ANTHROPIC_API_KEY: ENV.ANTHROPIC_API_KEY, STUDIO_RUN_ID: run.id, STUDIO_RUN_TOKEN: TOKEN, STUDIO_CALLBACK_URL: "https://austin.site/api/studio/runner", STUDIO_CODE_MODEL: "claude-test" });
  // Nothing handed to the sandbox, by any route, carries a site secret (name or value).
  const given = JSON.stringify([sandbox.state.created, sandbox.state.commands, sandbox.state.written]);
  for (const [name, value] of Object.entries(SECRETS)) { assert.ok(!given.includes(value), name); assert.ok(!given.includes(name), name); }
  for (const name of Object.keys(SECRETS)) assert.ok(!(name in runner.env!), name);

  assert.deepEqual(sandbox.state.written.map((file) => file.path), ["/tmp/studio-brief.json"]);
  assert.deepEqual(JSON.parse(sandbox.state.written[0].content), {
    runId: run.id, request: "Add a guestbook page", brief: "Add /guestbook with a form.", private: false, context: { route: "/", slot: "home.intro" },
    thread: [{ role: "owner", body: "Earlier question" }, { role: "claude", body: "Earlier answer" }, { role: "owner", body: "Add a guestbook page" }],
    overlay: { "site.wordmark": "Austin's site" }, // real published copy; unknown and invalid entries are left out
  });
  const stored = await row(run.id);
  assert.deepEqual([stored.status, stored.lane, stored.tokenHash], ["running", "code", hashToken(TOKEN)]);
  assert.ok(!JSON.stringify(await db.select().from(schema.runs)).includes(TOKEN)); // only the hash is kept
  assert.deepEqual((await view(run.id, run.threadId)).run.steps.map((step) => [step.text, step.state]), [["Starting a sandbox", "done"], ["Setting up the workspace", "doing"]]);
  assert.equal(sandbox.state.stopped, 0);

  // Without a deployed commit the runner comes from main; the model defaults to Opus.
  const plain = await world({ ...ENV, VERCEL_GIT_COMMIT_SHA: "not-a-sha; rm -rf /", STUDIO_CODE_MODEL: undefined });
  await plain.begin();
  assert.match(plain.sandbox.state.commands[0].args[1], /git fetch -q --depth=1 origin main;/);
  assert.equal(plain.sandbox.state.commands[1].env!.STUDIO_CODE_MODEL, "claude-opus-5-5");
});

test("a run that cannot start fails in plain words and leaves no sandbox behind", async () => {
  for (const missing of ["ANTHROPIC_API_KEY", "GITHUB_TOKEN"]) {
    const { deps, sandbox, begin, row } = await world({ ...ENV, [missing]: undefined });
    const run = await begin("x", { start: false });
    assert.deepEqual(await startCodeRun(deps, run), { ok: false, error: CODE_LANE_UNAVAILABLE });
    assert.deepEqual([(await row(run.id)).status, (await row(run.id)).result, sandbox.state.created.length], ["failed", { error: CODE_LANE_UNAVAILABLE }, 0]);
  }
  const noOrigin = await world(), orphan = await noOrigin.begin("x", { start: false });
  assert.deepEqual(await startCodeRun({ ...noOrigin.deps, origin: undefined }, orphan), { ok: false, error: CODE_LANE_UNAVAILABLE });

  const down = await world();
  down.sandbox.state.failCreate = true;
  const first = await down.begin("x", { start: false });
  const outcome = await startCodeRun(down.deps, first);
  assert.deepEqual(outcome, { ok: false, error: "The sandbox for this change could not be started. Try again in a minute." });
  assert.equal((await down.row(first.id)).status, "failed");

  const broken = await world();
  broken.sandbox.state.setupExit = 1;
  const second = await broken.begin("x", { start: false });
  assert.equal((await startCodeRun(broken.deps, second)).ok, false);
  assert.deepEqual([(await broken.row(second.id)).status, broken.sandbox.state.stopped, broken.sandbox.state.commands.length], ["failed", 1, 1]); // stopped, and the runner never started
  const logs = (await broken.view(second.id, second.threadId)).run.logs!.map((log) => log.text).join("\n");
  assert.match(logs, /Setup failed \(exit 1\)/);
});

test("the code lane takes at most 30 runs in 24 hours", async () => {
  const { db, deps, sandbox, begin, row, time } = await world();
  const run = await begin("first", { start: false });
  for (let i = 0; i < CODE_RUNS_PER_DAY - 1; i++) await db.insert(schema.runs).values({ id: crypto.randomUUID(), threadId: run.threadId, messageId: run.messageId, lane: "code", status: "done", createdAt: new Date(time.t - 60000) });
  await assert.rejects(startRun(db, { threadId: run.threadId, messageId: run.messageId, lane: "code", now: new Date(time.t) }), StudioLimit); // the store refuses the 31st
  assert.deepEqual(await startCodeRun(deps, run), { ok: true }); // the 30th itself is fine
  // One that got past the store anyway is refused before a sandbox is paid for.
  const extra = crypto.randomUUID();
  await db.update(schema.runs).set({ status: "done" }).where(eq(schema.runs.id, run.id));
  await db.insert(schema.runs).values({ id: extra, threadId: run.threadId, messageId: run.messageId, lane: "code", status: "running", createdAt: new Date(time.t) });
  assert.deepEqual(await startCodeRun(deps, { id: extra, threadId: run.threadId, messageId: run.messageId }), { ok: false, error: "The code lane has reached its limit for today." });
  assert.deepEqual([(await row(extra)).status, sandbox.state.created.length], ["failed", 1]);
  // A day later the window has moved on.
  time.t += 25 * 60 * 60 * 1000;
  const later = await startRun(db, { threadId: run.threadId, messageId: run.messageId, lane: "code", now: new Date(time.t) });
  assert.equal(later.status, "queued");
});

test("the runner route accepts only its run's token, only while the run is running, and never a session", async () => {
  const { db, deps, begin, event, row, view, time } = await world();
  const run = await begin();
  const before = (await view(run.id, run.threadId)).run.steps.length;
  const denied = async (response: Promise<Response>) => { const settled = await response; assert.equal(settled.status, 401); assert.deepEqual(await settled.json(), { error: "Not allowed." }); assert.equal(settled.headers.get("cache-control"), "no-store"); };
  await denied(event(run.id, null, "step", { text: "no token" }));
  await denied(event(run.id, `tok_${"b".repeat(40)}`, "step", { text: "wrong token" }));
  await denied(event(run.id, hashToken(TOKEN), "step", { text: "the stored hash is not the token" }));
  await denied(event("not-a-run", TOKEN, "step", { text: "x" }));
  await denied(event(crypto.randomUUID(), TOKEN, "step", { text: "x" }));
  // The owner's session (here the dev owner, which every owner-only route accepts) is not a substitute for the token.
  const asOwner = { ...deps, env: { ...ENV, NODE_ENV: "test", EDITOR_DEV_OWNER: "1" } };
  await denied(event(run.id, null, "step", { text: "owner cookie" }, { cookie: "better-auth.session_token=owner; editor=1" }, asOwner));
  await denied(event(run.id, null, "finish", { result: { outcome: "answered", summary: "x" } }, { cookie: "better-auth.session_token=owner" }, asOwner));
  await denied(runnerEvent(deps, new Request(`https://austin.site/api/studio/runner?token=${TOKEN}`, { method: "POST", body: JSON.stringify({ run: run.id, type: "heartbeat", token: TOKEN }) }))); // only the header counts
  assert.equal((await view(run.id, run.threadId)).run.steps.length, before);

  // Another run's token does not work here.
  const other = crypto.randomUUID();
  await db.insert(schema.runs).values({ id: other, threadId: run.threadId, messageId: run.messageId, lane: "code", status: "running", tokenHash: hashToken(`tok_${"z".repeat(40)}`) });
  await denied(event(other, TOKEN, "heartbeat"));
  await db.delete(schema.runs).where(eq(schema.runs.id, other));

  time.t += 30000;
  assert.deepEqual(await (await event(run.id, TOKEN, "step", { text: "  Adding the\nguestbook page  " })).json(), { ok: true, stop: false });
  assert.deepEqual(await (await event(run.id, TOKEN, "log", { text: "[Edit] src/app/guestbook/guestbook.css" })).json(), { ok: true, stop: false });
  const shown = (await view(run.id, run.threadId)).run;
  assert.deepEqual(shown.steps.at(-1), { seq: 3, text: "Adding the guestbook page", state: "doing", at: new Date(time.t).toISOString() });
  assert.deepEqual(shown.logs!.map((log) => log.text), ["[Edit] src/app/guestbook/guestbook.css"]);
  time.t += 30000;
  assert.equal((await event(run.id, TOKEN, "heartbeat")).status, 200);
  assert.equal((await row(run.id)).heartbeatAt!.getTime(), time.t);
  for (const type of ["merge", "publish", "revert", "", undefined]) assert.equal((await event(run.id, TOKEN, type as string)).status, 400); // step, log, heartbeat, finish; nothing else
  assert.equal((await event(run.id, TOKEN, "log", { text: "x".repeat(300000) })).status, 413);

  // Finishing retires the token: the same request sent again is refused, as is anything after the run has ended.
  assert.equal((await event(run.id, TOKEN, "finish", { result: { outcome: "answered", summary: "Nothing needed changing." } })).status, 200);
  assert.deepEqual([(await row(run.id)).status, (await row(run.id)).tokenHash], ["done", null]);
  await denied(event(run.id, TOKEN, "finish", { result: { outcome: "failed", error: "again" } }));
  await denied(event(run.id, TOKEN, "step", { text: "late" }));
  assert.equal((await row(run.id)).status, "done");

  // A run that ended some other way (reaped, stopped) no longer answers to its token either.
  const second = await begin("Another");
  await db.update(schema.runs).set({ status: "failed" }).where(eq(schema.runs.id, second.id));
  await denied(event(second.id, TOKEN, "heartbeat"));
  await denied(event(second.id, TOKEN, "finish", { result: changes(PAGE) }));
});

test("the happy path: files are read out of the sandbox, committed, opened as a PR, previewed, and squash-merged", async () => {
  const { sandbox, gh, begin, event, row, view, time } = await world();
  const run = await begin();
  stage(sandbox);
  let polls = 0;
  gh.state.preview = () => ++polls <= 4 ? "in_progress" : "success"; // two polls (each asks twice) before the build is done
  const waited = time.t;
  assert.deepEqual(await (await event(run.id, TOKEN, "finish", { result: changes(PAGE) })).json(), { ok: true, stop: false });

  for (const call of gh.state.calls) assert.equal(call.auth, `Bearer ${SECRETS.GITHUB_TOKEN}`);
  assert.deepEqual(gh.state.blobs, [".guestbook { color: var(--ink); }\n", "{}\n"]);
  assert.deepEqual(gh.state.trees, [{ base_tree: "tree-of-base", tree: [{ path: "src/app/guestbook/guestbook.css", mode: "100644", type: "blob", sha: "blob1" }, { path: "src/site/content.json", mode: "100644", type: "blob", sha: "blob2" }, { path: "src/app/old.css", mode: "100644", type: "blob", sha: null }] }]);
  assert.deepEqual(gh.state.commits.map((commit) => [commit.parents, commit.tree, String(commit.message).split("\n")[0]]), [[[BASE], "tree-new", "Add a guestbook page"]]);
  assert.deepEqual([gh.state.commits[0].author, /Co-Authored-By: Claude </.test(String(gh.state.commits[0].message))], [undefined, true]); // committed as the token's own user
  assert.match(String(gh.state.commits[0].message), new RegExp(`Requested in the site's studio: https://austin.site/studio/${run.threadId}`));
  assert.deepEqual(gh.state.refs, [`refs/heads/${branchName(run.id)}`]);
  assert.equal(branchName(run.id), `studio/${run.id.slice(0, 8)}`);
  const pr = gh.state.prs.get(7)!;
  assert.ok(pr.body.startsWith(`Requested in the site's studio ([thread](https://austin.site/studio/${run.threadId})):\n\n> Add a guestbook page\n\n`));
  assert.match(pr.body, /typecheck, lint, tests, build\), as it reports them: pass\./);
  assert.ok(pr.body.endsWith("There is now a guestbook at /guestbook.\n\nUsed a slot for the heading. &lt;!-- hidden --&gt; cc @​someone")); // the agent's words, made inert, last
  const merge = gh.state.calls.find((call) => call.method === "PUT")!;
  assert.deepEqual([merge.path, merge.body], ["/pulls/7/merge", { merge_method: "squash", sha: HEAD, commit_title: "Add a guestbook page (#7)" }]);
  assert.deepEqual(gh.state.deleted, [branchName(run.id)]);
  assert.equal(time.t - waited, 10000); // waited through two polls

  const done = await row(run.id), shown = await view(run.id, run.threadId);
  assert.deepEqual([done.status, done.summary, done.tokenHash], ["done", "Add a guestbook page", null]);
  assert.deepEqual(done.result, { branch: branchName(run.id), prNumber: 7, prUrl: "https://github.com/akrolsmir/austin-site/pull/7", previewUrl: "https://austin-site-git-studio.vercel.app/", mergeSha: MERGED });
  assert.deepEqual(shown.run.steps.map((step) => [step.text, step.state]), [["Starting a sandbox", "done"], ["Setting up the workspace", "done"], ["Saving 3 changed files", "done"], ["Opening a pull request", "done"], ["Waiting for the preview to build", "done"], ["Merging", "done"]]);
  assert.deepEqual(shown.run.can, { stop: false, revert: true, publish: false, discard: false });
  assert.deepEqual(shown.messages.at(-1), { id: shown.messages.at(-1)!.id, threadId: run.threadId, role: "claude", body: "There is now a guestbook at /guestbook.", private: false, createdAt: shown.messages.at(-1)!.createdAt, runId: run.id });
  assert.ok(sandbox.state.stopped >= 1);
  assert.ok(done.heartbeatAt!.getTime() >= waited + 10000); // kept fresh while waiting
});

test("a private request stays out of the pull request, and its reply stays private", async () => {
  const { sandbox, gh, begin, event, db } = await world();
  const run = await begin("PRIVATE-WORDS about the guestbook", { hidden: true });
  stage(sandbox);
  await event(run.id, TOKEN, "finish", { result: changes(PAGE, { title: "" }) });
  const pr = gh.state.prs.get(7)!;
  assert.ok(pr.body.startsWith("Requested privately in the site's studio.\n\n"));
  assert.equal(pr.title, "Studio change");
  assert.ok(!JSON.stringify(gh.state.calls).includes("PRIVATE-WORDS"));
  assert.ok(!JSON.stringify(gh.state.calls).includes("austin.site/studio/"));
  assert.equal((await getThread(db, "public", run.threadId)), null);
  assert.equal((await getThread(db, "owner", run.threadId))!.messages.at(-1)!.private, true);
});

test("guarded paths stop at needs_publish, and the owner's Publish merges", async () => {
  const { deps, sandbox, gh, begin, event, row, view } = await world();
  const run = await begin("Add a /api/hello route");
  sandbox.put("src/app/api/hello/route.ts", "export const GET = () => new Response('hi');\n");
  sandbox.put("src/app/page.tsx", "export default function Home() {}\n");
  sandbox.put("package.json", "{}\n");
  gh.state.preview = () => "in_progress";
  await event(run.id, TOKEN, "finish", { result: changes([{ path: "src/app/api/hello/route.ts", mode: "100644" }, { path: "src/app/page.tsx", mode: "100644" }, { path: "package.json", mode: "100644" }]) });
  let stored = await row(run.id);
  assert.deepEqual([stored.status, stored.endedAt, stored.result], ["needs_publish", null, { branch: branchName(run.id), prNumber: 7, prUrl: "https://github.com/akrolsmir/austin-site/pull/7", guarded: ["src/app/api/hello/route.ts", "src/app/page.tsx", "package.json"] }]);
  assert.match(gh.state.prs.get(7)!.body, /Waits for the owner's Publish because it changes more than copy, theme, and styles: `src\/app\/api\/hello\/route\.ts`, `src\/app\/page\.tsx`, `package\.json`\./);
  assert.ok(!gh.state.calls.some((call) => call.method === "PUT")); // nothing merged
  assert.ok(!gh.state.calls.some((call) => call.path.startsWith("/deployments"))); // and it did not wait for anything
  const shown = await view(run.id, run.threadId);
  assert.deepEqual([shown.run.can, shown.run.steps.at(-1)!.text, shown.messages.at(-1)!.body], [{ stop: false, revert: false, publish: true, discard: true }, "Waiting for your approval", "There is now a guestbook at /guestbook."]);
  assert.ok(sandbox.state.stopped >= 1);
  assert.equal((await event(run.id, TOKEN, "heartbeat")).status, 401); // the runner's part is over

  // Publish before the preview has built: nothing happens, and the run keeps waiting.
  assert.deepEqual(await publishCodeRun(deps, run), { ok: false, error: "The preview is still building. Try again in a minute." });
  assert.equal((await row(run.id)).status, "needs_publish");
  gh.state.preview = () => "success";
  assert.deepEqual(await publishCodeRun(deps, run), { ok: true });
  stored = await row(run.id);
  assert.deepEqual([stored.status, stored.result!.mergeSha, stored.result!.guarded, stored.result!.previewUrl], ["done", MERGED, ["src/app/api/hello/route.ts", "src/app/page.tsx", "package.json"], "https://austin-site-git-studio.vercel.app/"]);
  assert.deepEqual(await publishCodeRun(deps, run), { ok: false, error: "This run is not waiting to be published." });
  assert.equal(gh.state.calls.filter((call) => call.method === "PUT").length, 1);
});

test("the studio's publish and revert routes drive the code lane, for the owner only", async () => {
  const { db, deps, sandbox, gh, begin, event, row } = await world();
  const run = await begin("Change the sync");
  sandbox.put("src/lib/sync.ts", "export {};\n");
  await event(run.id, TOKEN, "finish", { result: changes([{ path: "src/lib/sync.ts", mode: "100644" }]) });
  const lane = { start: startCodeRun, publish: (_: CodeDeps, target: Parameters<typeof publishCodeRun>[1]) => publishCodeRun(deps, target), revert: (_: CodeDeps, target: Parameters<typeof revertCodeRun>[1]) => revertCodeRun(deps, target) };
  const post = (path: string) => new Request(`https://austin.site/api/studio${path}`, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: "{}" });
  const visitor = studioHandlers({ db: () => db, env: {}, code: lane }), owner = studioHandlers({ db: () => db, env: { NODE_ENV: "test", EDITOR_DEV_OWNER: "1" }, code: lane });
  assert.equal((await visitor.publish(post(`/runs/${run.id}/publish`), run.id)).status, 401);
  assert.equal((await visitor.revert(post(`/runs/${run.id}/revert`), run.id)).status, 401);
  assert.equal(gh.writes().filter((call) => call.method === "PUT").length, 0);
  assert.equal((await owner.revert(post(`/runs/${run.id}/revert`), run.id)).status, 409); // nothing merged yet
  const published = await owner.publish(post(`/runs/${run.id}/publish`), run.id);
  assert.deepEqual([published.status, (await published.json()).run.status], [200, "done"]);
  const reverted = await owner.revert(post(`/runs/${run.id}/revert`), run.id);
  assert.deepEqual([reverted.status, (await reverted.json()).run.status, (await row(run.id)).result!.revertSha], [200, "reverted", REVERTED]);
});

test("failed checks leave the PR open and the run failed", async () => {
  const { sandbox, gh, begin, event, row, view } = await world();
  const run = await begin();
  stage(sandbox);
  await event(run.id, TOKEN, "finish", { result: changes(PAGE, { checksPassed: false }) });
  const stored = await row(run.id);
  assert.deepEqual([stored.status, stored.result], ["failed", { branch: branchName(run.id), prNumber: 7, prUrl: "https://github.com/akrolsmir/austin-site/pull/7", error: "The checks did not pass, so this was not merged. The pull request is open for a look." }]);
  assert.match(gh.state.prs.get(7)!.body, /as it reports them: \*\*failed\*\*\./);
  assert.equal(gh.state.prs.get(7)!.state, "open");
  assert.ok(!gh.state.calls.some((call) => call.method === "PUT" || call.method === "DELETE"));
  const shown = await view(run.id, run.threadId);
  assert.equal(shown.messages.filter((message) => message.role === "claude" && message.runId === run.id).length, 0); // a failed run says so on its card, not in a reply
  assert.deepEqual(shown.run.can, { stop: false, revert: false, publish: false, discard: false });
  assert.ok(sandbox.state.stopped >= 1);
});

test("a failed preview, a closed PR, and a failed merge each end the run with the PR link", async () => {
  const failed = await world(), first = await failed.begin();
  stage(failed.sandbox);
  failed.gh.state.preview = () => "error";
  await failed.event(first.id, TOKEN, "finish", { result: changes(PAGE) });
  assert.deepEqual([(await failed.row(first.id)).status, (await failed.row(first.id)).result!.error, (await failed.row(first.id)).result!.prUrl], ["failed", "The preview build failed, so this was not merged. The pull request is open for a look.", "https://github.com/akrolsmir/austin-site/pull/7"]);
  assert.ok(!failed.gh.state.calls.some((call) => call.method === "PUT"));

  const conflict = await world(), second = await conflict.begin();
  stage(conflict.sandbox);
  conflict.gh.state.mergeFailures = 1;
  await conflict.event(second.id, TOKEN, "finish", { result: changes(PAGE) });
  const stored = await conflict.row(second.id);
  assert.deepEqual([stored.status, stored.result!.error], ["failed", "The pull request could not be merged (it may conflict with a newer change). It is still open."]);
  assert.ok(!JSON.stringify([stored, (await conflict.view(second.id, second.threadId)).run]).includes("SECRET-RESPONSE-BODY")); // GitHub's words are not repeated anywhere
  assert.ok(!JSON.stringify((await conflict.view(second.id, second.threadId)).run).includes(SECRETS.GITHUB_TOKEN));

  // Someone merged it by hand in the meantime: the run records that merge instead of failing.
  const byHand = await world(), third = await byHand.begin();
  stage(byHand.sandbox);
  byHand.gh.state.preview = () => "in_progress";
  await byHand.event(third.id, TOKEN, "finish", { result: changes(PAGE) }, {}, { ...byHand.deps, waitMs: 0 });
  Object.assign(byHand.gh.state.prs.get(7)!, { state: "closed", merged: true, merge_commit_sha: MERGED });
  byHand.time.t += LEASE_MS + 1000;
  await sweepCodeRuns(byHand.deps);
  assert.deepEqual([(await byHand.row(third.id)).status, (await byHand.row(third.id)).result!.mergeSha], ["done", MERGED]);

  const closed = await world(), fourth = await closed.begin();
  stage(closed.sandbox);
  closed.gh.state.preview = () => "in_progress";
  await closed.event(fourth.id, TOKEN, "finish", { result: changes(PAGE) }, {}, { ...closed.deps, waitMs: 0 });
  closed.gh.state.prs.get(7)!.state = "closed";
  closed.time.t += LEASE_MS + 1000;
  await sweepCodeRuns(closed.deps);
  assert.deepEqual([(await closed.row(fourth.id)).status, (await closed.row(fourth.id)).result!.error], ["failed", "The pull request was closed without being merged."]);
});

test("a preview that outlives the finish request is picked up by the sweep, which merges it or times it out", async () => {
  const { db, deps, sandbox, gh, begin, event, row, time } = await world();
  const run = await begin();
  stage(sandbox);
  gh.state.preview = () => "none"; // Vercel has not reported a deployment yet
  const started = time.t;
  await event(run.id, TOKEN, "finish", { result: changes(PAGE) }, {}, { ...deps, waitMs: 60000 });
  assert.ok(time.t - started >= 60000 && time.t - started <= 70000); // one request waits only so long
  let stored = await row(run.id);
  assert.deepEqual([stored.status, stored.tokenHash, stored.result!.prNumber, stored.result!.mergeSha], ["running", null, 7, undefined]);
  assert.equal(stored.heartbeatAt!.getTime(), time.t); // fresh, so the reaper leaves it alone
  assert.equal((await event(run.id, TOKEN, "heartbeat")).status, 401);

  // The run is leased by its heartbeat: nothing is due right away, and two ticks at once check GitHub once.
  assert.equal(await codeSweepDue(db, new Date(time.t)), false);
  time.t += LEASE_MS + 1000;
  assert.equal(await codeSweepDue(db, new Date(time.t)), true);
  const before = gh.state.calls.length;
  await Promise.all([sweepCodeRuns(deps), sweepCodeRuns(deps)]);
  assert.equal(gh.state.calls.length - before, 2); // one PR lookup, one deployments lookup
  assert.equal((await row(run.id)).status, "running");
  assert.equal(await codeSweepDue(db, new Date(time.t)), false);

  // A studio read is the tick that schedules the sweep.
  time.t += LEASE_MS + 1000;
  const tasks: Array<() => Promise<void>> = [];
  const visitor = studioHandlers({ db: () => db, env: { GITHUB_TOKEN: SECRETS.GITHUB_TOKEN }, now: () => new Date(time.t), fetch: gh.fetch, after: (task) => { tasks.push(task); } });
  assert.equal((await visitor.threads(new Request("https://austin.site/api/studio/threads"))).status, 200);
  assert.equal(tasks.length, 1);
  gh.state.preview = () => "success";
  await tasks[0]();
  stored = await row(run.id);
  assert.deepEqual([stored.status, stored.result!.mergeSha, stored.result!.previewUrl], ["done", MERGED, "https://austin-site-git-studio.vercel.app/"]);
  assert.equal(await codeSweepDue(db, new Date(time.t + LEASE_MS * 2)), false);

  // A preview that never arrives fails the run after PREVIEW_MAX_MS, with the PR left open.
  const never = await world(), second = await never.begin();
  stage(never.sandbox);
  never.gh.state.preview = () => "queued";
  await never.event(second.id, TOKEN, "finish", { result: changes(PAGE) }, {}, { ...never.deps, waitMs: 0 });
  never.time.t += PREVIEW_MAX_MS - 60000;
  await sweepCodeRuns(never.deps);
  assert.equal((await never.row(second.id)).status, "running");
  never.time.t += 61000;
  await sweepCodeRuns(never.deps);
  assert.deepEqual([(await never.row(second.id)).status, (await never.row(second.id)).result!.error, never.gh.state.prs.get(7)!.state], ["failed", "The preview did not finish building in time, so this was not merged. The pull request is open.", "open"]);
});

test("files that may not ship are refused before anything reaches GitHub", async () => {
  const refused = async (arrange: (site: Awaited<ReturnType<typeof world>>) => unknown, pattern: RegExp) => {
    const site = await world(), run = await site.begin();
    stage(site.sandbox);
    const result = arrange(site);
    assert.equal((await site.event(run.id, TOKEN, "finish", { result })).status, 200);
    const stored = await site.row(run.id);
    assert.equal(stored.status, "failed");
    assert.match(stored.result!.error!, pattern);
    assert.deepEqual(site.gh.writes(), [], stored.result!.error); // no blob, commit, branch, or PR
    assert.ok(site.sandbox.state.stopped >= 1);
  };
  await refused(() => changes([...PAGE, { path: ".env.local", mode: "100644" }]), /cannot be shipped from the studio: \.env\.local\./);
  await refused(() => changes([{ path: "../../etc/cron.d/x", mode: "100644" }]), /cannot be shipped from the studio/);
  await refused(() => changes([{ path: ".git/config", mode: "100644" }]), /cannot be shipped from the studio/);
  await refused(() => changes([{ path: "public/link", mode: "120000" }]), /public\/link is a symlink/);
  // The report says "plain file" but the sandbox's own git index says symlink: the index wins.
  await refused((site) => { site.sandbox.put("public/photo.jpg", "/proc/self/environ", "120000"); return changes([{ path: "public/photo.jpg", mode: "100644" }]); }, /public\/photo\.jpg is a symlink/);
  await refused(() => changes([{ path: "never-added.ts", mode: "100644" }]), /never-added\.ts is a symlink or another special file/);
  await refused((site) => { site.sandbox.put("src/app/old.css", "still here"); return changes(PAGE); }, /old\.css was reported as deleted but is still there/);
  await refused((site) => { site.sandbox.put("public/big.bin", Buffer.alloc(MAX_FILE_BYTES + 1)); return changes([{ path: "public/big.bin", mode: "100644" }]); }, /public\/big\.bin is too large/);
  await refused((site) => { site.sandbox.put("src/app/leak.ts", `const key = "${ENV.ANTHROPIC_API_KEY}";`); return changes([{ path: "src/app/leak.ts", mode: "100644" }]); }, /src\/app\/leak\.ts contains a secret/);
  await refused((site) => { site.gh.state.onMain = false; return changes(PAGE); }, /not based on the site's main branch/);
  await refused(() => ({ outcome: "changes", base: "HEAD", files: [] }), /could not be read/);
  await refused(() => "garbage", /could not be read/);
  await refused(() => ({ outcome: "failed", error: "Something went wrong in the sandbox while making this change." }), /^Something went wrong in the sandbox/);
});

test("stop: the runner hears it on its next call, a finish after it pushes nothing, and silence ends the run after a grace period", async () => {
  const { db, sandbox, gh, begin, event, row, view, time } = await world();
  const run = await begin();
  stage(sandbox);
  await requestStop(db, run.id, new Date(time.t));
  const pressed = time.t, steps = (await view(run.id, run.threadId)).run.steps.length;
  time.t += 5000;
  assert.deepEqual(await (await event(run.id, TOKEN, "heartbeat")).json(), { ok: true, stop: true });
  assert.deepEqual(await (await event(run.id, TOKEN, "step", { text: "Carrying on regardless" })).json(), { ok: true, stop: true });
  assert.equal((await view(run.id, run.threadId)).run.steps.length, steps); // nothing more is recorded
  assert.equal((await row(run.id)).heartbeatAt!.getTime(), pressed); // and the grace period is not pushed back
  await event(run.id, TOKEN, "finish", { result: changes(PAGE) }); // a runner that ignores Stop and reports work anyway
  assert.deepEqual([(await row(run.id)).status, gh.writes().length], ["stopped", 0]);
  assert.ok(sandbox.state.stopped >= 1);

  const polite = await world(), second = await polite.begin();
  await requestStop(polite.db, second.id, new Date(polite.time.t));
  await polite.event(second.id, TOKEN, "finish", { result: { outcome: "stopped" } });
  assert.equal((await polite.row(second.id)).status, "stopped");

  // The runner never answers: after the grace period the sweep ends the run and stops its sandbox.
  const silent = await world(), third = await silent.begin();
  await requestStop(silent.db, third.id, new Date(silent.time.t));
  silent.time.t += STOP_GRACE_MS - 10000;
  assert.equal(await codeSweepDue(silent.db, new Date(silent.time.t)), true);
  await sweepCodeRuns(silent.deps);
  assert.deepEqual([(await silent.row(third.id)).status, silent.sandbox.state.stopped], ["running", 0]);
  silent.time.t += 11000;
  await sweepCodeRuns(silent.deps);
  assert.deepEqual([(await silent.row(third.id)).status, silent.sandbox.state.stopped], ["stopped", 1]);
  assert.equal((await silent.event(third.id, TOKEN, "finish", { result: changes(PAGE) })).status, 401);

  // Stop while the preview builds: the PR stays open and nothing merges.
  const waiting = await world(), fourth = await waiting.begin();
  stage(waiting.sandbox);
  waiting.gh.state.preview = () => "in_progress";
  await waiting.event(fourth.id, TOKEN, "finish", { result: changes(PAGE) }, {}, { ...waiting.deps, waitMs: 0 });
  await requestStop(waiting.db, fourth.id, new Date(waiting.time.t));
  waiting.gh.state.preview = () => "success";
  waiting.time.t += LEASE_MS + 1000;
  await sweepCodeRuns(waiting.deps);
  assert.deepEqual([(await waiting.row(fourth.id)).status, waiting.gh.state.prs.get(7)!.state, waiting.gh.state.calls.some((call) => call.method === "PUT")], ["stopped", "open", false]);
});

test("revert opens GitHub's revert PR for the merge and merges it at once", async () => {
  const { deps, sandbox, gh, begin, event, row, view } = await world();
  const run = await begin();
  assert.deepEqual(await revertCodeRun(deps, run), { ok: false, error: "This run has nothing to revert." }); // not merged yet
  stage(sandbox);
  await event(run.id, TOKEN, "finish", { result: changes(PAGE) });
  gh.state.mergeFailures = 2; // GitHub has not worked out mergeability yet
  const before = gh.state.calls.length;
  assert.deepEqual(await revertCodeRun(deps, run), { ok: true });
  const made = gh.state.calls.slice(before);
  assert.deepEqual(made.map((call) => `${call.method} ${call.path}`), ["GET /pulls/7", "POST /graphql", "PUT /pulls/8/merge", "PUT /pulls/8/merge", "PUT /pulls/8/merge", "DELETE /git/refs/heads/revert-7-studio"]);
  assert.deepEqual(made[1].body!.variables, { id: "PR_node7" });
  assert.match(String(made[1].body!.query), /revertPullRequest\(input: \{ pullRequestId: \$id \}\)/);
  assert.deepEqual(made[2].body, { merge_method: "squash", sha: "9".repeat(40), commit_title: "Revert \"Add a guestbook page\" (#8)" });
  const stored = await row(run.id);
  assert.deepEqual([stored.status, stored.result!.revertSha, stored.result!.mergeSha], ["reverted", REVERTED, MERGED]);
  assert.deepEqual((await view(run.id, run.threadId)).run.can, { stop: false, revert: false, publish: false, discard: false });
  assert.deepEqual(await revertCodeRun(deps, run), { ok: false, error: "This run has nothing to revert." }); // once

  // A revert that conflicts is left as an open PR, and the run stays as it was.
  const conflict = await world(), second = await conflict.begin();
  stage(conflict.sandbox);
  await conflict.event(second.id, TOKEN, "finish", { result: changes(PAGE) });
  conflict.gh.state.mergeFailures = 99;
  assert.deepEqual(await revertCodeRun(conflict.deps, second), { ok: false, error: "The revert conflicts with newer changes, so it was not merged. Its pull request is open on GitHub." });
  assert.deepEqual([(await conflict.row(second.id)).status, conflict.gh.state.prs.get(8)!.state], ["done", "open"]);
  assert.deepEqual(await revertCodeRun({ ...conflict.deps, env: { ...ENV, GITHUB_TOKEN: undefined } }, second), { ok: false, error: CODE_LANE_UNAVAILABLE });
});

test("an answer without changes is posted as Claude's reply, and the GitHub client keeps secrets and response bodies out of errors", async () => {
  const { gh, begin, event, row, view } = await world();
  const run = await begin("Why is the build slow?");
  await event(run.id, TOKEN, "finish", { result: { outcome: "answered", summary: "The build prerenders every post." } });
  const shown = await view(run.id, run.threadId);
  assert.deepEqual([(await row(run.id)).status, shown.messages.at(-1)!.body, shown.messages.at(-1)!.runId, gh.state.calls.length], ["done", "The build prerenders every post.", run.id, 0]);

  assert.equal(github({}), null);
  assert.equal(github({ GITHUB_TOKEN: "t", GITHUB_REPO: "someone/else" })!.repo, "someone/else");
  assert.equal(github({ GITHUB_TOKEN: "t", GITHUB_REPO: "../../evil?x" })!.repo, "akrolsmir/austin-site");
  const client = github({ GITHUB_TOKEN: "ghp_TOKEN" }, (async () => new Response("{\"message\":\"BODY ghp_TOKEN\"}", { status: 500 })) as unknown as typeof fetch)!;
  await assert.rejects(client.pr(7), (error: Error) => error.message === "GitHub GET /repos/akrolsmir/austin-site/pulls/7 answered 500");
  const odd = github({ GITHUB_TOKEN: "t" }, (async (input: RequestInfo | URL) => String(input).includes("/statuses") ? Response.json([{ state: "success", environment_url: "javascript:alert(1)" }]) : Response.json([{ id: 1 }, { id: 2 }])) as unknown as typeof fetch)!;
  assert.deepEqual(await odd.preview(HEAD), { state: "success", url: undefined }); // only an https preview link is kept
});

test("no build at all is reported early; discard closes the pull request; the sweep ends a fast-lane Stop nobody answered", async () => {
  // GitHub knows of no deployment minutes after the push: Vercel is not building this repository. Say so instead of timing out.
  const { deps, db, sandbox, gh, begin, event, row, time } = await world();
  const run = await begin();
  stage(sandbox);
  gh.state.preview = () => "none";
  let finished = 0;
  await event(run.id, TOKEN, "finish", { result: changes(PAGE) }, {}, { ...deps, waitMs: 0, onFinish: () => { finished++; } });
  assert.deepEqual([(await row(run.id)).status, finished], ["running", 1]);
  time.t += NO_BUILD_MS + 1000;
  assert.ok(NO_BUILD_MS < PREVIEW_MAX_MS);
  await sweepCodeRuns(deps);
  assert.deepEqual([(await row(run.id)).status, (await row(run.id)).result!.error, gh.state.prs.get(7)!.state], ["failed", NO_BUILD, "open"]);

  // Waiting for Publish with no build: Publish explains, the run keeps waiting, and Discard closes the PR and ends it.
  const held = await world(), second = await held.begin();
  held.sandbox.put("src/app/page.tsx", "export default function Home() {}\n");
  held.gh.state.preview = () => "none";
  await held.event(second.id, TOKEN, "finish", { result: changes([{ path: "src/app/page.tsx", mode: "100644" }]) });
  assert.deepEqual(await discardCodeRun(held.deps, { ...second, id: run.id }), { ok: false, error: "This run is not waiting to be published." });
  held.time.t += NO_BUILD_MS + 1000;
  assert.deepEqual(await publishCodeRun(held.deps, second), { ok: false, error: NO_BUILD });
  assert.equal((await held.row(second.id)).status, "needs_publish");
  assert.deepEqual(await discardCodeRun(held.deps, second), { ok: true });
  const gone = await held.row(second.id);
  assert.deepEqual([gone.status, gone.result!.discarded, held.gh.state.prs.get(7)!.state, held.gh.state.deleted, held.gh.state.calls.some((call) => call.method === "PUT")], ["stopped", true, "closed", [branchName(second.id)], false]);
  assert.deepEqual(await publishCodeRun(held.deps, second), { ok: false, error: "This run is not waiting to be published." });

  // A fast-lane run whose function died cannot hear Stop. After the grace period the sweep ends it, so the queue moves.
  const thread = await createThread(db, { body: "quick", now: new Date(time.t) }), message = (await postMessage(db, { threadId: thread.id, role: "owner", body: "quick", now: new Date(time.t) }))!;
  const fast = await startRun(db, { threadId: thread.id, messageId: message.id, now: new Date(time.t) });
  assert.equal((await claimNextRun(db, new Date(time.t)))?.id, fast.id);
  await requestStop(db, fast.id, new Date(time.t));
  time.t += STOP_GRACE_MS + 1000;
  assert.equal(await codeSweepDue(db, new Date(time.t)), true);
  const stops = sandbox.state.stopped;
  await sweepCodeRuns(deps);
  assert.deepEqual([(await row(fast.id)).status, sandbox.state.stopped], ["stopped", stops]);
});

test("with an OpenRouter key the sandbox gets a bearer token, the OpenRouter endpoint, and OpenRouter model names", async () => {
  const key = "sk-or-v1-OPENROUTER-KEY-0123456789";
  const { deps, sandbox, begin } = await world({ ...ENV, OPENROUTER_API_KEY: key, STUDIO_CODE_MODEL: undefined });
  const run = await begin("x", { start: false });
  assert.deepEqual(await startCodeRun(deps, run), { ok: true });
  const given = sandbox.state.commands[1].env!;
  assert.deepEqual([given.ANTHROPIC_AUTH_TOKEN, given.ANTHROPIC_BASE_URL, given.ANTHROPIC_API_KEY, given.STUDIO_CODE_MODEL], [key, "https://openrouter.ai/api", undefined, "anthropic/claude-opus-5.5"]);
});
