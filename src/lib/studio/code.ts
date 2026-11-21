import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "../../db";
import { runLogs, runSteps, runs } from "../../db/schema";
import { overlayStore, type OverlayStore } from "../overlay";
import { resolveSite } from "../../site/schema";
import { GitHubError, github, repoOf, type FileChange } from "./github";
import { SANDBOX_ROOT, TooBig, vercelSandbox, type Box, type SandboxClient } from "./sandbox";
import { CODE_RUNS_PER_DAY, DAY_MS, addLog, addStep, finishRun, getMessage, getRun, history, markReverted, noteResult, postMessage, touchRun, type RunRow } from "./store";
import { MAX_MESSAGE_CHARS, threadTitle } from "./types";

// The code lane (docs/editable-site.md, "Code lane"). A code change takes minutes and a Vercel function gets 300 s, so no
// single request carries a run. It moves forward in short hops, each one a request with its own time budget:
//
//  1. startCodeRun (inside the posting request's after(), or a poll's): mints a per-run token and stores its hash, creates
//     a Vercel Sandbox with the repo cloned, copies scripts/studio-runner.ts out of the deployed commit, writes the brief,
//     and starts the runner detached. It returns as soon as the runner is going; the run stays "running".
//  2. The runner (in the sandbox, with only ANTHROPIC_API_KEY and the token) drives the Agent SDK and the checks. Each of
//     its POSTs to /api/studio/runner (step, log, heartbeat) is a tiny request that keeps the run's heartbeat fresh and
//     tells it whether the owner pressed Stop.
//  3. Its last POST, "finish", retires the token and does the GitHub work in that request (maxDuration 300): reads the
//     changed files out of the sandbox, commits them to studio/<short id> through the Git Data API, opens a PR, then
//     waits for the preview deployment and squash-merges. That automatic merge is only for changes confined to
//     AUTO_MERGE_PATHS (copy and theme defaults, stylesheets); anything else stops at "needs_publish", and
//     publishCodeRun merges on the owner's approval (discardCodeRun closes the pull request instead).
//  4. If the preview outlives that request, the run stays "running" with its PR recorded and no token. A scheduler tick
//     (any studio read, and the /api/studio/tick cron) calls codeSweepDue/sweepCodeRuns, which checks the preview once
//     per 20 s lease and merges or fails the run. The PR itself is the state, so any request can resume it.
//  5. Stop flags the run; the runner hears it on its next POST and finishes as "stopped". A run (of either lane) that
//     does not answer within STOP_GRACE_MS is ended by the sweep, and the stale-run reaper covers everything else.
//
// Nothing the sandbox says is trusted: the token only works for its own run while it is running, paths and sizes are
// checked here, file modes are read from the sandbox's git index rather than the report, and GitHub decides what merges.
export const CODE_LANE_UNAVAILABLE = "The code lane isn't set up yet.";
export const CODE_MODEL = "claude-opus-5-5";
/**
 * The only paths a run may change and still merge by itself once its preview builds (`**` crosses directories, `*` does
 * not): data and presentation that cannot run code. Everything else executes somewhere that matters (on the server next
 * to the site's secrets, at build time, or in the owner's signed-in browser), so it waits for the owner's Publish. This
 * is an allow-list on purpose: a file nobody thought of is guarded.
 */
export const AUTO_MERGE_PATHS = ["src/site/content.json", "src/site/theme.json", "src/app/**.css", "src/editor/**.css"];
export const MAX_FILES = 200, MAX_FILE_BYTES = 1024 * 1024, MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const STOP_GRACE_MS = 2 * 60 * 1000, PREVIEW_MAX_MS = 12 * 60 * 1000, NO_BUILD_MS = 3 * 60 * 1000, LEASE_MS = 20 * 1000;
export const NO_BUILD = "Vercel is not building this repository's pull requests, so there is no preview to check. Connect the GitHub repository in the Vercel project's Git settings.";
const SANDBOX_MS = 40 * 60 * 1000, WAIT_MS = 200 * 1000, POLL_MS = 5000, MAX_STEPS = 300, MAX_LOGS = 3000, MAX_BODY = 256 * 1024;
const RUNNER_DIR = "/tmp/studio-runner", RUNNER_FILE = "scripts/studio-runner.ts", BRIEF_PATH = "/tmp/studio-brief.json";
type Env = Record<string, string | undefined>;
export type CodeDeps = {
  db: Db; env?: Env; fetch?: typeof fetch; now?: () => Date; revalidate?: () => void; origin?: string;
  /** Tests pass fakes for these. */
  sandbox?: SandboxClient; overlay?: OverlayStore; sleep?: (ms: number) => Promise<void>; token?: () => string;
  /** How long one request waits for the preview before leaving it to the sweep. */
  waitMs?: number;
  /** Called when a runner's finish has been handled (the run ended, or waits on its preview), so the queue can move on. */
  onFinish?: () => void;
};
export type CodeRun = Pick<RunRow, "id" | "threadId" | "messageId">;
/** `error` is a sentence that is safe to show to anyone. */
export type CodeOutcome = { ok: true } | { ok: false; error: string };
/** What the runner sends with "finish". Everything in it is checked again here. */
export type RunnerResult =
  | { outcome: "answered"; summary: string } | { outcome: "failed"; error: string } | { outcome: "stopped" }
  | { outcome: "changes"; base: string; files: Array<{ path: string; mode: "100644" | "100755" | null }>; title: string; summary: string; details: string; checksPassed: boolean };
/** A reason the change cannot ship; the message is public. */
class Refused extends Error { constructor(message: string) { super(message); this.name = "Refused"; } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const sandboxName = (runId: string) => `studio-${runId}`;
export const branchName = (runId: string) => `studio/${runId.slice(0, 8)}`;
const str = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
// Text from the model or the owner, made safe for a PR body: it cannot open an HTML comment or notify GitHub users.
const inert = (text: string) => text.replace(/<!--/g, "&lt;!--").replace(/-->/g, "--&gt;").replace(/@(?=\w)/g, "@\u200b");
const describe = (error: unknown) => error instanceof GitHubError ? error.message : error instanceof Error ? error.name : "unknown error";

/** Whether `path` matches a glob of literal characters, `*` (within one directory), and `**` (across directories). */
export function globMatch(glob: string, path: string): boolean {
  const pattern = glob.split("**").map((part) => part.split("*").map((text) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*");
  return new RegExp(`^${pattern}$`).test(path);
}
/** The changed paths that keep a run from merging by itself: all those outside AUTO_MERGE_PATHS. */
export const guardedPaths = (paths: string[]) => paths.filter((path) => !AUTO_MERGE_PATHS.some((glob) => globMatch(glob, path)));
/** A repo-relative path the lane will commit: inside the repo, not under .git, not an env file, no odd characters. */
export function safePath(path: unknown): path is string {
  if (typeof path !== "string" || !path || path.length > 300 || path.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(path)) return false;
  const parts = path.split("/");
  return parts.every((part) => part && part !== "." && part !== ".." && !/^\.env/i.test(part)) && parts[0] !== ".git";
}
/** Checks the shape of a runner's result. Throws Refused (public) for a path that may not ship; null for anything unreadable. */
export function parseResult(value: unknown): RunnerResult | null {
  if (!plain(value)) return null;
  if (value.outcome === "stopped") return { outcome: "stopped" };
  if (value.outcome === "answered") return { outcome: "answered", summary: str(value.summary, MAX_MESSAGE_CHARS) };
  if (value.outcome === "failed") return { outcome: "failed", error: str(value.error, 300) || "The run failed." };
  if (value.outcome !== "changes" || typeof value.base !== "string" || !/^[0-9a-f]{40}$/.test(value.base) || !Array.isArray(value.files) || !value.files.length) return null;
  if (value.files.length > MAX_FILES) throw new Refused(`This change touches more than ${MAX_FILES} files, which is too many to ship from the studio.`);
  const files: Extract<RunnerResult, { outcome: "changes" }>["files"] = [], seen = new Set<string>();
  for (const file of value.files as unknown[]) {
    if (!plain(file) || typeof file.path !== "string") return null;
    if (!safePath(file.path)) throw new Refused(`This change touches a file that cannot be shipped from the studio: ${str(file.path, 80) || "(unnamed)"}.`);
    if (file.mode !== "100644" && file.mode !== "100755" && file.mode !== null) throw new Refused(`${file.path} is a symlink or another special file, which cannot be shipped from the studio.`);
    if (seen.has(file.path)) return null;
    seen.add(file.path);
    files.push({ path: file.path, mode: file.mode });
  }
  return { outcome: "changes", base: value.base, files, title: str(value.title, 70).replace(/\s+/g, " "), summary: str(value.summary, 2000), details: str(value.details, 20000), checksPassed: value.checksPassed === true };
}

function context(deps: CodeDeps) {
  const { db, env = process.env, now = () => new Date() } = deps;
  return {
    db, env, now, sandbox: deps.sandbox ?? vercelSandbox(), gh: github(env, deps.fetch ?? fetch), sleep: deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    log: (runId: string, text: string) => addLog(db, runId, text, now()).catch(() => {}),
    fail: async (runId: string, error: string, detail?: string): Promise<CodeOutcome> => {
      if (detail) await addLog(db, runId, detail, now()).catch(() => {});
      await finishRun(db, runId, { status: "failed", result: { error }, now: now() });
      return { ok: false, error };
    },
    stopBox: async (runId: string) => { try { await (await (deps.sandbox ?? vercelSandbox()).get(sandboxName(runId)))?.stop(); } catch { /* it stops by itself at its timeout */ } },
  };
}

/**
 * Takes over a run that is "running" with lane "code" (the fast lane escalated it with `brief`). Returns once the runner
 * is started; the run stays "running" (heartbeats and steps come in through /api/studio/runner) until the lane finishes it.
 */
export async function startCodeRun(deps: CodeDeps, run: CodeRun, brief?: string): Promise<CodeOutcome> {
  const { db, env, now, sandbox, gh, log, fail } = context(deps);
  let callback: URL | undefined;
  try { callback = new URL("/api/studio/runner", deps.origin); } catch { /* no origin */ }
  if (!env.ANTHROPIC_API_KEY || !gh || !callback || !/^https?:$/.test(callback.protocol)) return fail(run.id, CODE_LANE_UNAVAILABLE, `Missing: ${[!env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY", !gh && "GITHUB_TOKEN", !callback && "the site's origin"].filter(Boolean).join(", ")}`);
  let box: Box | undefined;
  try {
    // The cap is enforced where a run enters the lane (startRun, escalateRun); this run is already counted, hence ">".
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(runs).where(and(eq(runs.lane, "code"), gte(runs.createdAt, new Date(now().getTime() - DAY_MS))));
    if (n > CODE_RUNS_PER_DAY) return await fail(run.id, "The code lane has reached its limit for today.");
    const trigger = await getMessage(db, run.messageId);
    if (!trigger) return await fail(run.id, "The message for this run is missing.");
    const thread = (await history(db, run)).map((row) => ({ role: row.role, body: row.body.slice(0, MAX_MESSAGE_CHARS) }));
    // Published slot values that differ from the code defaults, so the agent sees the copy that is really on the site.
    const published = await (deps.overlay ?? overlayStore(env)).read().then(({ overlay }) => { const { dropped } = resolveSite(overlay); return Object.fromEntries(Object.entries(overlay).filter(([id]) => !dropped.includes(id))); }).catch(() => ({}));
    const token = deps.token?.() ?? randomBytes(32).toString("base64url");
    const [claimed] = await db.update(runs).set({ tokenHash: hashToken(token), heartbeatAt: now() }).where(and(eq(runs.id, run.id), eq(runs.status, "running"), eq(runs.lane, "code"))).returning({ id: runs.id });
    if (!claimed) return { ok: false, error: "This run is no longer running." };

    await addStep(db, run.id, "Starting a sandbox", { now: now() });
    box = await sandbox.create({ name: sandboxName(run.id), repo: repoOf(env), revision: "main", timeoutMs: SANDBOX_MS });
    await addStep(db, run.id, "Setting up the workspace", { now: now() });
    // The runner is the one from the commit this site was deployed from, not whatever the clone (or the agent) has.
    const ref = /^[0-9a-f]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? "") ? env.VERCEL_GIT_COMMIT_SHA! : "main";
    const setup = await box.run("bash", ["-c", `set -eo pipefail; command -v bun >/dev/null || [ -x "$HOME/.bun/bin/bun" ] || curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"; rm -rf ${RUNNER_DIR}; mkdir -p ${RUNNER_DIR}; git fetch -q --depth=1 origin ${ref}; git archive FETCH_HEAD ${RUNNER_FILE} | tar -x -C ${RUNNER_DIR}`]);
    if (setup.exitCode !== 0) { await log(run.id, `Setup failed (exit ${setup.exitCode}):\n${setup.output.slice(-1500)}`); throw new Error("setup failed"); }
    await box.write([{ path: BRIEF_PATH, content: JSON.stringify({ runId: run.id, request: trigger.body.slice(0, MAX_MESSAGE_CHARS), brief: brief ?? "", private: trigger.private, context: trigger.context ?? null, thread, overlay: published }) }]);
    // Everything the sandbox is given: the model key (the agent's own) and this run's token. No GitHub, database, Blob, or auth secret.
    await box.run("bash", ["-c", `export PATH="$HOME/.bun/bin:$PATH"; exec bun ${RUNNER_DIR}/${RUNNER_FILE} > /tmp/studio-runner.log 2>&1`], {
      detached: true, env: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, STUDIO_RUN_ID: run.id, STUDIO_RUN_TOKEN: token, STUDIO_CALLBACK_URL: callback.href, STUDIO_CODE_MODEL: env.STUDIO_CODE_MODEL || CODE_MODEL },
    });
    await touchRun(db, run.id, now());
    return { ok: true };
  } catch (error) {
    console.error(`Studio code lane: could not start (${describe(error)}).`);
    if (box) await box.stop().catch(() => {});
    return fail(run.id, "The sandbox for this change could not be started. Try again in a minute.", `Start failed: ${describe(error)}`);
  }
}

/** The run a runner's token belongs to, or null. Constant time in the token; a token only works while its run is running. */
export async function runnerRun(db: Db, runId: unknown, token: string): Promise<RunRow | null> {
  const run = typeof runId === "string" && UUID.test(runId) ? await getRun(db, runId) : undefined;
  const stored = run && run.lane === "code" && run.status === "running" ? run.tokenHash : null;
  const same = timingSafeEqual(Buffer.from(hashToken(token), "hex"), Buffer.from(stored && /^[0-9a-f]{64}$/.test(stored) ? stored : hashToken(randomBytes(16).toString("hex")), "hex"));
  return same && stored && token ? run! : null;
}
/**
 * POST /api/studio/runner: the runner's only way in. `Authorization: Bearer <run token>` and a JSON body
 * `{ run, type: "step" | "log" | "heartbeat" | "finish", text?, result? }`. Answers `{ ok, stop }`; `stop` tells the runner
 * the owner pressed Stop. A session cookie is never looked at.
 */
export async function runnerEvent(deps: CodeDeps, request: Request): Promise<Response> {
  const { db, now } = context(deps);
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const denied = () => json({ error: "Not allowed." }, 401);
  try {
    const token = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token) return denied();
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: "That request is too large." }, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = null; }
    const run = await runnerRun(db, plain(body) ? body.run : null, token);
    if (!run || !plain(body)) return denied();
    const type = body.type;
    if (type !== "step" && type !== "log" && type !== "heartbeat" && type !== "finish") return json({ error: "There is no such event." }, 400);
    if (type === "finish") {
      // The token is retired in the same statement that claims the finish, so a run finishes once.
      const [claimed] = await db.update(runs).set({ tokenHash: null, heartbeatAt: now() }).where(and(eq(runs.id, run.id), eq(runs.status, "running"), eq(runs.tokenHash, run.tokenHash!))).returning();
      if (!claimed) return denied();
      await finishCode(deps, claimed, body.result);
      deps.onFinish?.();
      return json({ ok: true, stop: false });
    }
    // After Stop nothing more is recorded, and the heartbeat is left alone so the grace period runs from the press.
    if (run.stopRequested) return json({ ok: true, stop: true });
    const line = str(body.text, 4000), count = async (table: typeof runSteps | typeof runLogs) => (await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.runId, run.id)))[0].n;
    if (type === "step" && line && await count(runSteps) < MAX_STEPS) await addStep(db, run.id, line.replace(/\s+/g, " ").slice(0, 120), { now: now() });
    else if (type === "log" && line && await count(runLogs) < MAX_LOGS) { await addLog(db, run.id, line, now()); await touchRun(db, run.id, now()); }
    else await touchRun(db, run.id, now());
    return json({ ok: true, stop: false });
  } catch (error) {
    console.error(`Studio runner event failed (${describe(error)}).`);
    return json({ error: "Something went wrong." }, 500);
  }
}

// The changed files' contents, read out of the sandbox. The file list is the runner's, so each entry is checked against
// the sandbox's own git index: a path whose mode there is not the plain file the report claims (a symlink, a submodule,
// nothing at all) is refused. A file holding the model key verbatim is refused too, so the sandbox's one secret cannot
// be committed by accident.
async function readChanges(box: Box, files: Extract<RunnerResult, { outcome: "changes" }>["files"], secrets: string[]): Promise<FileChange[]> {
  const listing = await box.run("git", ["-C", SANDBOX_ROOT, "ls-files", "-s", "-z"]);
  if (listing.exitCode !== 0) throw new Error("git ls-files failed");
  const modes = new Map(listing.output.split("\0").filter(Boolean).map((entry) => { const tab = entry.indexOf("\t"); return [entry.slice(tab + 1), entry.slice(0, 6)] as const; }));
  const out: FileChange[] = [];
  let total = 0;
  for (const file of files) {
    if (file.mode === null) { if (modes.has(file.path)) throw new Refused(`${file.path} was reported as deleted but is still there.`); out.push({ path: file.path, deleted: true }); continue; }
    if (modes.get(file.path) !== file.mode) throw new Refused(`${file.path} is a symlink or another special file, which cannot be shipped from the studio.`);
    let content: Buffer | null;
    try { content = await box.read(`${SANDBOX_ROOT}/${file.path}`, Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - total)); }
    catch (error) { if (error instanceof TooBig) throw new Refused(`${file.path} is too large to ship from the studio (or the change is too large overall).`); throw error; }
    if (!content) throw new Refused(`${file.path} could not be read back from the sandbox.`);
    if (secrets.some((secret) => secret.length >= 8 && content.includes(secret))) throw new Refused(`${file.path} contains a secret, so nothing was saved.`);
    total += content.length;
    out.push({ path: file.path, mode: file.mode, content });
  }
  return out;
}

// The runner is done: record its answer, or push its changes and carry the PR as far as this request's time allows.
async function finishCode(deps: CodeDeps, run: RunRow, raw: unknown): Promise<void> {
  const { db, env, now, sandbox, gh, log, fail, stopBox } = context(deps);
  let prUrl: string | undefined;
  try {
    const result = parseResult(raw), trigger = await getMessage(db, run.messageId);
    const say = async (text: string) => { await postMessage(db, { threadId: run.threadId, role: "claude", body: text.slice(0, MAX_MESSAGE_CHARS), private: trigger?.private ?? true, runId: run.id, now: now() }); };
    if (run.stopRequested || result?.outcome === "stopped") { await finishRun(db, run.id, { status: "stopped", now: now() }); return; }
    if (!result) { await fail(run.id, "The sandbox sent back something that could not be read."); return; }
    if (result.outcome === "failed") { await fail(run.id, result.error); return; }
    if (result.outcome === "answered") { await say(result.summary || "I looked into it and changed nothing."); await finishRun(db, run.id, { status: "done", now: now() }); return; }
    if (!gh) { await fail(run.id, CODE_LANE_UNAVAILABLE, "Missing: GITHUB_TOKEN"); return; }
    await addStep(db, run.id, `Saving ${result.files.length} changed file${result.files.length === 1 ? "" : "s"}`, { now: now() });
    const box = await sandbox.get(sandboxName(run.id));
    if (!box) { await fail(run.id, "The sandbox was gone before its work could be saved."); return; }
    const files = await readChanges(box, result.files, [env.ANTHROPIC_API_KEY ?? ""]);
    await box.stop().catch(() => {});
    if (!(await gh.onMain(result.base))) throw new Refused("The change was not based on the site's main branch, so nothing was saved.");
    // A private request stays out of the (public) repository: the PR says only that it was asked for privately.
    const hidden = trigger?.private ?? true, request = trigger?.body ?? "", title = result.title || (hidden ? "Studio change" : threadTitle(request));
    const where = !hidden && deps.origin ? `${new URL(`/studio/${run.threadId}`, deps.origin)}` : "";
    const branch = branchName(run.id), paths = files.map((file) => file.path);
    const head = await gh.commit({ branch, parent: result.base, files, message: `${title}\n\nRequested in the site's studio${where ? `: ${where}` : "."}\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n` });
    await noteResult(db, run.id, { branch }, now());
    await addStep(db, run.id, "Opening a pull request", { now: now() });
    const guarded = guardedPaths(paths);
    const pr = await gh.openPr({ branch, title, body: [
      hidden ? "Requested privately in the site's studio." : `Requested in the site's studio${where ? ` ([thread](${where}))` : ""}:\n\n> ${inert(request).replace(/\n/g, "\n> ")}`,
      `Checks run in the sandbox (typecheck, lint, tests, build), as it reports them: ${result.checksPassed ? "pass" : "**failed**"}.${guarded.length ? `\n\nWaits for the owner's Publish because it changes more than copy, theme, and styles: ${guarded.slice(0, 50).map((path) => `\`${path}\``).join(", ")}${guarded.length > 50 ? `, and ${guarded.length - 50} more` : ""}.` : ""}`,
      `Opened by Claude from the studio. What it says about the change:\n\n---\n\n${inert([result.summary, result.details].filter(Boolean).join("\n\n")) || "(nothing)"}`,
    ].join("\n\n") });
    prUrl = pr.url || undefined;
    await noteResult(db, run.id, { prNumber: pr.number, ...(prUrl ? { prUrl } : {}) }, now());
    await log(run.id, `Opened PR #${pr.number} at ${head.slice(0, 12)} with ${paths.length} files: ${paths.join(", ").slice(0, 3000)}`);
    if (!result.checksPassed) { await fail(run.id, "The checks did not pass, so this was not merged. The pull request is open for a look."); return; }
    if (result.summary) await say(result.summary);
    if (guarded.length) {
      await addStep(db, run.id, "Waiting for your approval", { now: now() });
      await finishRun(db, run.id, { status: "needs_publish", summary: title, result: { guarded: guarded.slice(0, 50) }, now: now() });
      return;
    }
    await addStep(db, run.id, "Waiting for the preview to build", { now: now() });
    await advance(deps, run.id, "wait");
  } catch (error) {
    console.error(`Studio code lane: finishing failed (${describe(error)}).`);
    await fail(run.id, error instanceof Refused ? error.message : prUrl ? "Something went wrong after the pull request was opened. It is still open." : "Something went wrong while saving the changes.", `Finish failed: ${describe(error)}`);
  } finally {
    if ((await getRun(db, run.id))?.status !== "running") await stopBox(run.id);
  }
}

/**
 * Carries a run with an open PR one hop forward: merged when the preview deployment succeeded, failed when it failed (the
 * PR stays open), otherwise "pending". "wait" polls for up to `waitMs` with the heartbeat kept fresh; "once" (the sweep)
 * and "publish" (the owner's approval, which has no deadline) check a single time.
 */
async function advance(deps: CodeDeps, runId: string, mode: "wait" | "once" | "publish"): Promise<"merged" | "failed" | "stopped" | "pending" | "unbuilt"> {
  const { db, now, gh, sleep, log, fail } = context(deps);
  const run = await getRun(db, runId), number = run?.result?.prNumber, started = now().getTime();
  if (!run || !number || !gh) return "pending";
  const done = async (mergeSha: string, title: string, previewUrl?: string) => { await finishRun(db, runId, { status: "done", summary: title, result: { mergeSha, ...(previewUrl ? { previewUrl } : {}) }, now: now() }); return "merged" as const; };
  const pr = await gh.pr(number);
  if (pr.merged && pr.mergeSha) return done(pr.mergeSha, pr.title);
  if (!pr.open) { await fail(runId, "The pull request was closed without being merged."); return "failed"; }
  let previewUrl: string | undefined;
  for (;;) {
    if (mode !== "publish" && (await getRun(db, runId))?.stopRequested) { await finishRun(db, runId, { status: "stopped", now: now() }); return "stopped"; }
    const preview = await gh.preview(pr.head);
    previewUrl = preview.url;
    if (preview.state === "success") break;
    if (previewUrl) await noteResult(db, runId, { previewUrl }, now()); else await touchRun(db, runId, now());
    if (preview.state === "failure") { await fail(runId, "The preview build failed, so this was not merged. The pull request is open for a look."); return "failed"; }
    // GitHub hears of a Vercel build within seconds of a push. Minutes without one means the repository is not connected.
    if (preview.none && now().getTime() - pr.createdAt.getTime() > NO_BUILD_MS) { if (mode === "publish") return "unbuilt"; await fail(runId, NO_BUILD); return "failed"; }
    if (mode !== "publish" && now().getTime() - pr.createdAt.getTime() > PREVIEW_MAX_MS) { await fail(runId, "The preview did not finish building in time, so this was not merged. The pull request is open."); return "failed"; }
    if (mode !== "wait" || now().getTime() - started > (deps.waitMs ?? WAIT_MS)) return "pending";
    await sleep(POLL_MS);
  }
  if (mode !== "publish") await addStep(db, runId, "Merging", { now: now() });
  try {
    const mergeSha = await gh.merge(number, pr.head, `${pr.title} (#${number})`);
    await gh.deleteBranch(pr.branch).catch(() => {});
    return await done(mergeSha, pr.title, previewUrl);
  } catch (error) {
    // Two requests can reach the merge at once; the one that lost finds the PR merged.
    const again = await gh.pr(number).catch(() => null);
    if (again?.merged && again.mergeSha) return done(again.mergeSha, pr.title, previewUrl);
    await log(runId, `Merge failed: ${describe(error)}`);
    await fail(runId, "The pull request could not be merged (it may conflict with a newer change). It is still open.");
    return "failed";
  }
}

const sweepable = eq(runs.status, "running");
/** Whether sweepCodeRuns has anything to do: one cheap query, so every scheduler tick can ask. */
export async function codeSweepDue(db: Db, now = new Date()): Promise<boolean> {
  const rows = await db.select({ lane: runs.lane, token: runs.tokenHash, stop: runs.stopRequested, result: runs.result }).from(runs).where(and(sweepable, lt(runs.heartbeatAt, new Date(now.getTime() - LEASE_MS))));
  return rows.some((row) => row.stop || (row.lane === "code" && !row.token && Boolean(row.result?.prNumber)));
}
/**
 * The scheduler tick's sweep. A code-lane run waiting on its preview (PR open, token retired) is checked once and merged
 * or failed; a run of either lane whose Stop was not answered within the grace period (its function or sandbox is gone)
 * is ended, and its sandbox stopped. Each run is leased by its heartbeat, so concurrent ticks do not repeat the work.
 */
export async function sweepCodeRuns(deps: CodeDeps): Promise<void> {
  const { db, now, stopBox } = context(deps);
  for (const row of await db.select().from(runs).where(sweepable)) {
    try {
      const waiting = row.lane === "code" && !row.tokenHash && Boolean(row.result?.prNumber);
      if (!waiting && !(row.stopRequested && row.heartbeatAt && now().getTime() - row.heartbeatAt.getTime() > STOP_GRACE_MS)) continue;
      const [leased] = await db.update(runs).set({ heartbeatAt: now() }).where(and(eq(runs.id, row.id), sweepable, lt(runs.heartbeatAt, new Date(now().getTime() - LEASE_MS)))).returning({ id: runs.id });
      if (!leased) continue;
      if (waiting) await advance(deps, row.id, "once");
      else { await finishRun(db, row.id, { status: "stopped", now: now() }); if (row.lane === "code") await stopBox(row.id); }
    } catch (error) { console.error(`Studio code lane: the sweep failed for a run (${describe(error)}).`); }
  }
}

/** The owner approved a run waiting at "needs_publish": merge it (once its preview has built) and finish the run. */
export async function publishCodeRun(deps: CodeDeps, run: CodeRun): Promise<CodeOutcome> {
  const { db, gh } = context(deps), row = await getRun(db, run.id);
  if (!gh) return { ok: false, error: CODE_LANE_UNAVAILABLE };
  if (row?.status !== "needs_publish" || !row.result?.prNumber) return { ok: false, error: "This run is not waiting to be published." };
  try {
    const outcome = await advance(deps, run.id, "publish");
    if (outcome === "merged") return { ok: true };
    return { ok: false, error: outcome === "pending" ? "The preview is still building. Try again in a minute." : outcome === "unbuilt" ? NO_BUILD : (await getRun(db, run.id))?.result?.error ?? "This could not be published." };
  } catch (error) {
    console.error(`Studio code lane: publishing failed (${describe(error)}).`);
    await addLog(db, run.id, `Publish failed: ${describe(error)}`).catch(() => {});
    return { ok: false, error: "GitHub could not be reached. Try again in a minute." };
  }
}
/** The owner turned down a run waiting at "needs_publish": close its pull request, delete the branch, and end the run. */
export async function discardCodeRun(deps: CodeDeps, run: CodeRun): Promise<CodeOutcome> {
  const { db, now, gh, log } = context(deps), row = await getRun(db, run.id);
  if (!gh) return { ok: false, error: CODE_LANE_UNAVAILABLE };
  if (row?.status !== "needs_publish" || !row.result?.prNumber) return { ok: false, error: "This run is not waiting to be published." };
  try {
    const pr = await gh.pr(row.result.prNumber);
    if (pr.merged) return { ok: false, error: "The pull request was already merged on GitHub." };
    if (pr.open) await gh.closePr(pr.number);
    await gh.deleteBranch(pr.branch).catch(() => {});
    await finishRun(db, run.id, { status: "stopped", result: { discarded: true }, now: now() });
    return { ok: true };
  } catch (error) {
    console.error(`Studio code lane: discarding failed (${describe(error)}).`);
    await log(run.id, `Discard failed: ${describe(error)}`);
    return { ok: false, error: "GitHub could not be reached. Try again in a minute." };
  }
}
/**
 * Reverts a merged code-lane run and marks it "reverted". It opens GitHub's own revert pull request for the run's PR
 * (GraphQL revertPullRequest) and squash-merges it at once. That was chosen over writing a revert commit through the Git
 * Data API (the merge commit's parent tree on top of main) because the tree trick is only correct while main has not
 * moved since the merge, and the usual revert is of an older run with newer ones on top; GitHub computes a real revert
 * and refuses on a conflict, in which case the revert PR is left open for the owner.
 */
export async function revertCodeRun(deps: CodeDeps, run: CodeRun): Promise<CodeOutcome> {
  const { db, now, gh, sleep, log } = context(deps), row = await getRun(db, run.id);
  if (!gh) return { ok: false, error: CODE_LANE_UNAVAILABLE };
  if (row?.status !== "done" || !row.result?.mergeSha || !row.result.prNumber) return { ok: false, error: "This run has nothing to revert." };
  try {
    const pr = await gh.pr(row.result.prNumber), revert = await gh.revertPr(pr.nodeId);
    await log(run.id, `Opened revert PR #${revert.number}`);
    // GitHub needs a moment to work out whether a new PR can merge; until then the merge answers 405.
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const revertSha = await gh.merge(revert.number, revert.head, `Revert "${pr.title}" (#${revert.number})`);
        await gh.deleteBranch(revert.branch).catch(() => {});
        await markReverted(db, run.id, { result: { revertSha }, now: now() });
        return { ok: true };
      } catch (error) {
        if (!(error instanceof GitHubError) || ![405, 409, 422].includes(error.status)) throw error;
        await sleep(2000 * (attempt + 1));
      }
    }
    await log(run.id, `Revert PR #${revert.number} could not be merged`);
    return { ok: false, error: "The revert conflicts with newer changes, so it was not merged. Its pull request is open on GitHub." };
  } catch (error) {
    console.error(`Studio code lane: reverting failed (${describe(error)}).`);
    await log(run.id, `Revert failed: ${describe(error)}`);
    return { ok: false, error: "The revert could not be made. Try again in a minute." };
  }
}
