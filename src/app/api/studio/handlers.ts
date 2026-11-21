import { dbEnabled, getDb, type Db } from "../../../db";
import { getOwner, requireOwner } from "../../../lib/auth";
import { OverlayConflict, OverlayNotFound, OverlayUnavailable, overlayStore, type OverlayStore } from "../../../lib/overlay";
import { publishCodeRun, revertCodeRun, startCodeRun, type CodeDeps, type CodeOutcome, type CodeRun } from "../../../lib/studio/code";
import { runFast, type FastClient } from "../../../lib/studio/fast";
import { StudioLimit, checkCaps, claimNextRun, createThread, finishRun, getRun, getThread, listThreads, markReverted, messageView, postMessage, queueIdle, reapStaleRuns, requestStop, runView, startRun, threadSummary, type RunRow, type Viewer } from "../../../lib/studio/store";
import { MAX_MESSAGE_CHARS, parseContext, runActions, type CreatedThreadResponse, type PostedMessageResponse, type RunResponse, type ThreadResponse, type ThreadsResponse } from "../../../lib/studio/types";

// The studio routes' logic (docs/editable-site.md, "Studio"; shapes in src/lib/studio/types.ts), with the database, auth,
// the model client, the overlay store, `after`, and revalidation injected so tests run it against PGlite and fakes.
// Writes resolve the owner before anything else. Reads are public and filtered by viewer. Everything answers in JSON.
const MAX_JSON_BYTES = 64 * 1024, DRAIN_MS = 200 * 1000, CURSOR_SLACK_MS = 5000;
type Env = Record<string, string | undefined>;
export type StudioDeps = {
  env?: Env;
  /** The database. Omit to use Neon when DATABASE_URL is set; without either, the studio is "not configured". */
  db?: () => Db;
  owner?: (request: Request) => Promise<unknown>; viewer?: (headers: Headers) => Promise<unknown>;
  /** Runs work after the response is sent (`after` from next/server). */
  after?: (task: () => Promise<void>) => void;
  overlay?: () => OverlayStore; revalidate?: () => void; now?: () => Date; client?: FastClient | null; fetch?: typeof fetch;
  code?: { start: Run; publish: Run; revert: Run };
  /** Executes one claimed run to its end (or hands it off). Defaults to the fast lane, or the code lane for a code-lane run. */
  execute?: (run: RunRow, origin: string) => Promise<void>;
};
type Run = (deps: CodeDeps, run: CodeRun, brief?: string) => Promise<CodeOutcome>;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (status: number, error: string) => json({ error }, status);
class Refused extends Error { constructor(public status: number, message: string) { super(message); } }
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sameSite = (request: Request) => ["same-origin", "none", null].includes(request.headers.get("sec-fetch-site"));
async function body(request: Request) {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) throw new Refused(415, "Send JSON.");
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new Refused(413, "That request is too large.");
  let parsed: unknown;
  try { parsed = JSON.parse(text || "{}"); } catch { throw new Refused(400, "That request is not valid JSON."); }
  if (!plain(parsed)) throw new Refused(400, "That request is not a JSON object.");
  return parsed;
}
function newMessage(input: Record<string, unknown>) {
  const text = typeof input.body === "string" ? input.body.trim() : "";
  if (!text) throw new Refused(400, "Write a message first.");
  if (text.length > MAX_MESSAGE_CHARS) throw new Refused(400, `Messages can be at most ${MAX_MESSAGE_CHARS} characters.`);
  if (text.includes("\u0000")) throw new Refused(400, "That message contains characters that cannot be stored.");
  if (input.private !== undefined && typeof input.private !== "boolean") throw new Refused(400, "`private` must be true or false.");
  const context = parseContext(input.context);
  if (context === null) throw new Refused(400, "That context is not valid.");
  return { body: text, private: input.private === true, context };
}

export function studioHandlers(deps: StudioDeps = {}) {
  const { env = process.env, owner = (request) => requireOwner(request, env), viewer = (headers) => getOwner(headers, env), after = (task) => { void task(); }, now = () => new Date() } = deps;
  const code = deps.code ?? { start: startCodeRun, publish: publishCodeRun, revert: revertCodeRun };
  const configured = () => Boolean(deps.db) || dbEnabled(env);
  const database = () => deps.db ? deps.db() : getDb(env);
  const overlay = deps.overlay ?? (() => overlayStore(env));
  const report = (what: string, error: unknown) => console.error(`${what} (${error instanceof Error ? error.name : "unknown error"}).`);
  // Revalidation is best effort: a publish that is already live must not be reported as failed because of it.
  const revalidate = () => { try { deps.revalidate?.(); } catch (error) { report("Studio revalidation failed", error); } };
  // read_page fetches from the configured site URL when there is one, otherwise from wherever this request arrived.
  const originOf = (request: Request) => { try { return new URL(env.BETTER_AUTH_URL || request.url).origin; } catch { return new URL(request.url).origin; } };
  const codeDeps = (origin: string): CodeDeps => ({ db: database(), env, fetch: deps.fetch, now, revalidate, origin });
  const execute = deps.execute ?? (async (run, origin) => {
    if (run.lane === "fast") return runFast({ db: database(), overlay: overlay(), env, client: deps.client, origin, fetch: deps.fetch, revalidate, now, startCode: code.start }, run);
    const handed = await code.start(codeDeps(origin), run);
    if (!handed.ok) await finishRun(database(), run.id, { status: "failed", result: { error: handed.error }, now: now() });
  });
  // Claims and executes queued runs, oldest first, until none is claimable (none queued, or one is running elsewhere, or a
  // code-lane run was handed off and is still going) or this function's time is nearly up. Whatever is left is picked up by
  // the next request: a post, or a poll that finds the queue idle.
  const drain = (origin: string) => async () => {
    try {
      const db = database(), started = Date.now();
      while (Date.now() - started < DRAIN_MS) {
        const run = await claimNextRun(db, now());
        if (!run) return;
        try { await execute(run, origin); } catch (error) {
          report("A studio run failed", error);
          await finishRun(db, run.id, { status: "failed", result: { error: "Something went wrong on the site's side." }, now: now() });
        }
      }
    } catch (error) { report("The studio queue failed", error); }
  };
  const answer = async (request: Request, write: boolean, run: (db: Db, who: Viewer) => Promise<Response>, empty?: () => Response) => {
    try {
      if (write) await owner(request);
      if (write && !sameSite(request)) return fail(403, "Cross-site requests are not allowed.");
      if (!configured()) return empty ? empty() : fail(503, "The studio is not set up on this site yet.");
      return await run(database(), write || (await viewer(request.headers)) ? "owner" : "public");
    } catch (error) {
      if (error instanceof Response) return fail(error.status, error.status === 401 ? "Sign in as the owner." : "Not allowed.");
      if (error instanceof Refused) return fail(error.status, error.message);
      if (error instanceof StudioLimit) return fail(429, error.message);
      if (error instanceof OverlayNotFound) return fail(409, "The version before this change is no longer available.");
      if (error instanceof OverlayConflict) return fail(409, "The site changed at the same moment. Try again.");
      if (error instanceof OverlayUnavailable) return fail(503, "Publishing is not set up on this site yet.");
      report("Studio request failed", error);
      return fail(500, "Something went wrong.");
    }
  };
  // Reads double as the scheduler's tick: end runs that died, and wake the queue if it is waiting on nobody.
  const tick = async (db: Db, request: Request) => { await reapStaleRuns(db, now()); if (await queueIdle(db)) after(drain(originOf(request))); };
  const cursor = () => new Date(now().getTime() - CURSOR_SLACK_MS).toISOString();
  const found = async (db: Db, id: string) => { const run = ID.test(id) ? await getRun(db, id) : undefined; if (!run) throw new Refused(404, "There is no such run."); return run; };
  const shown = async (db: Db, id: string, status = 200) => json({ run: await runView(db, "owner", (await getRun(db, id))!) } satisfies RunResponse, status);

  return {
    threads: (request: Request) => answer(request, false, async (db, who) => {
      await tick(db, request);
      return json({ configured: true, owner: who === "owner", threads: await listThreads(db, who) } satisfies ThreadsResponse);
    }, () => json({ configured: false, owner: false, threads: [] } satisfies ThreadsResponse)),
    createThread: (request: Request) => answer(request, true, async (db) => {
      const input = newMessage(await body(request));
      await checkCaps(db, "fast", now());
      const thread = await createThread(db, { ...input, now: now() });
      const message = (await postMessage(db, { ...input, threadId: thread.id, role: "owner", now: now() }))!;
      const run = await startRun(db, { threadId: thread.id, messageId: message.id, now: now() });
      after(drain(originOf(request)));
      return json({ thread: await threadSummary(db, thread), message: messageView({ ...message, runId: run.id }, "owner"), run: await runView(db, "owner", run) } satisfies CreatedThreadResponse, 201);
    }),
    thread: (request: Request, id: string) => answer(request, false, async (db, who) => {
      const param = new URL(request.url).searchParams.get("after"), after = param === null ? undefined : new Date(param);
      if (after && Number.isNaN(after.getTime())) throw new Refused(400, "`after` must be a timestamp.");
      await tick(db, request);
      const at = cursor(), detail = ID.test(id) ? await getThread(db, who, id, { after }) : null;
      if (!detail) throw new Refused(404, "There is no such thread.");
      return json({ configured: true, owner: who === "owner", ...detail, at } satisfies ThreadResponse);
    }, () => json({ configured: false, owner: false, thread: null, messages: [], runs: [], at: cursor() } satisfies ThreadResponse)),
    postMessage: (request: Request, id: string) => answer(request, true, async (db) => {
      const input = newMessage(await body(request));
      await checkCaps(db, "fast", now());
      const message = ID.test(id) ? await postMessage(db, { ...input, threadId: id, role: "owner", now: now() }) : null;
      if (!message) throw new Refused(404, "There is no such thread.");
      const run = await startRun(db, { threadId: id, messageId: message.id, now: now() });
      after(drain(originOf(request)));
      return json({ message: messageView({ ...message, runId: run.id }, "owner"), run: await runView(db, "owner", run) } satisfies PostedMessageResponse, 201);
    }),
    stop: (request: Request, id: string) => answer(request, true, async (db) => {
      await body(request);
      await found(db, id);
      await requestStop(db, id, now());
      return shown(db, id);
    }),
    revert: (request: Request, id: string) => answer(request, true, async (db) => {
      await body(request);
      const run = await found(db, id);
      if (!runActions({ lane: run.lane, status: run.status, result: run.result ?? null }).revert) throw new Refused(409, "This run has nothing to revert.");
      if (run.lane === "fast") {
        // Back to the version that was live before this run's first publish (none recorded: the code defaults).
        await overlay().revert(run.result?.previousOverlayHash ?? null, { summary: "Reverted a studio change", by: "revert" });
        revalidate();
        await markReverted(db, id, { now: now() });
      } else {
        const outcome = await code.revert(codeDeps(originOf(request)), run);
        if (!outcome.ok) throw new Refused(503, outcome.error);
      }
      return shown(db, id);
    }),
    publish: (request: Request, id: string) => answer(request, true, async (db) => {
      await body(request);
      const run = await found(db, id);
      if (run.status !== "needs_publish") throw new Refused(409, "This run is not waiting to be published.");
      const outcome = await code.publish(codeDeps(originOf(request)), run);
      if (!outcome.ok) throw new Refused(503, outcome.error);
      return shown(db, id);
    }),
  };
}
