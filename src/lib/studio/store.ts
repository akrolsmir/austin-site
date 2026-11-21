import { and, asc, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db";
import { messages, runLogs, runSteps, runs, threads, type MessageContext, type RunResult } from "../../db/schema";
import { runActions, threadTitle, type Lane, type MessageView, type Role, type RunStatus, type RunView, type StepState, type ThreadSummary } from "./types";

// The studio's data functions (docs/editable-site.md, "Studio"). Each takes the db, so tests run them against PGlite with the
// real schema. Every read takes the viewer: a "public" viewer never gets private threads or messages, a message's context,
// a private message's run, or run logs. Each state change is a single statement (the neon-http driver has no interactive
// transactions), written so that two requests racing each other cannot both win.
export type Viewer = "owner" | "public";
export type ThreadRow = typeof threads.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export const STALE_MS = 15 * 60 * 1000, DAY_MS = 24 * 60 * 60 * 1000, CODE_RUNS_PER_DAY = 30, MAX_QUEUED = 10, LOG_LINES = 100;
export const STALE_ERROR = "This run stopped responding and was ended.";
/** A cap was hit; `message` is safe to show. */
export class StudioLimit extends Error { constructor(message: string) { super(message); this.name = "StudioLimit"; } }

const id = () => crypto.randomUUID();
const iso = (date: Date) => date.toISOString();
const ts = (date: Date) => sql`${iso(date)}::timestamptz`;
const merged = (patch: RunResult) => sql<RunResult>`coalesce(${runs.result}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`;
const nextSeq = (table: "run_steps" | "run_logs", runId: string) => sql<number>`(select coalesce(max(seq), 0) + 1 from ${sql.raw(table)} where run_id = ${runId})`;

const summaryOf = (row: ThreadRow, status: RunStatus | null): ThreadSummary => ({ id: row.id, title: row.title, private: row.private, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), status });
export const messageView = (row: MessageRow, viewer: Viewer): MessageView => ({
  id: row.id, threadId: row.threadId, role: row.role, body: row.body, private: row.private, createdAt: iso(row.createdAt), runId: row.runId,
  ...(viewer === "owner" && row.context ? { context: row.context } : {}),
});
/** Runs as the API returns them: with their checklist, and with the private log only for the owner. */
export async function runViews(db: Db, viewer: Viewer, rows: RunRow[]): Promise<RunView[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const steps = await db.select().from(runSteps).where(inArray(runSteps.runId, ids)).orderBy(asc(runSteps.seq), asc(runSteps.id));
  const logs = viewer === "owner" ? await Promise.all(ids.map((runId) => db.select().from(runLogs).where(eq(runLogs.runId, runId)).orderBy(desc(runLogs.seq), desc(runLogs.id)).limit(LOG_LINES))) : null;
  return rows.map((row, index) => {
    const base = { lane: row.lane, status: row.status, result: row.result ?? null };
    return {
      id: row.id, threadId: row.threadId, messageId: row.messageId, ...base, summary: row.summary, stopRequested: row.stopRequested && row.status === "running",
      createdAt: iso(row.createdAt), startedAt: row.startedAt ? iso(row.startedAt) : null, endedAt: row.endedAt ? iso(row.endedAt) : null,
      steps: steps.filter((step) => step.runId === row.id).map((step) => ({ seq: step.seq, text: step.text, state: step.state, at: iso(step.at) })),
      can: runActions(base),
      ...(logs ? { logs: logs[index].reverse().map((log) => ({ seq: log.seq, text: log.text, at: iso(log.at) })) } : {}),
    };
  });
}
export const runView = async (db: Db, viewer: Viewer, row: RunRow) => (await runViews(db, viewer, [row]))[0];

// A run is as visible as the owner message that started it.
const visibleRuns = (db: Db, viewer: Viewer, where: SQL | undefined) =>
  db.select({ run: runs }).from(runs).innerJoin(messages, eq(runs.messageId, messages.id)).where(and(where, viewer === "public" ? eq(messages.private, false) : undefined)).orderBy(asc(runs.createdAt), asc(runs.id));
async function latestStatuses(db: Db, viewer: Viewer, threadIds: string[]) {
  const latest = new Map<string, RunStatus>();
  if (threadIds.length) for (const { run } of await visibleRuns(db, viewer, inArray(runs.threadId, threadIds))) latest.set(run.threadId, run.status);
  return latest;
}

export async function listThreads(db: Db, viewer: Viewer): Promise<ThreadSummary[]> {
  const rows = await db.select().from(threads).where(viewer === "public" ? eq(threads.private, false) : undefined).orderBy(desc(threads.updatedAt), desc(threads.id)).limit(100);
  const latest = await latestStatuses(db, viewer, rows.map((row) => row.id));
  return rows.map((row) => summaryOf(row, latest.get(row.id) ?? null));
}
/**
 * One thread with its messages and runs, oldest first, or null when it does not exist or the viewer may not see it.
 * With `after`, only messages posted and runs touched (any step, status change, or heartbeat) at or after that time.
 */
export async function getThread(db: Db, viewer: Viewer, threadId: string, { after }: { after?: Date } = {}) {
  const [row] = await db.select().from(threads).where(eq(threads.id, threadId));
  if (!row || (row.private && viewer === "public")) return null;
  const open = viewer === "public" ? eq(messages.private, false) : undefined;
  const posts = await db.select().from(messages).where(and(eq(messages.threadId, threadId), open, after ? gte(messages.createdAt, after) : undefined)).orderBy(asc(messages.createdAt), asc(messages.id));
  const touched = await visibleRuns(db, viewer, and(eq(runs.threadId, threadId), after ? or(gte(runs.createdAt, after), gte(runs.heartbeatAt, after)) : undefined));
  const status = (await latestStatuses(db, viewer, [threadId])).get(threadId) ?? null;
  return { thread: summaryOf(row, status), messages: posts.map((post) => messageView(post, viewer)), runs: await runViews(db, viewer, touched.map(({ run }) => run)) };
}
export const getRun = async (db: Db, runId: string): Promise<RunRow | undefined> => (await db.select().from(runs).where(eq(runs.id, runId)))[0];
export const getMessage = async (db: Db, messageId: string): Promise<MessageRow | undefined> => (await db.select().from(messages).where(eq(messages.id, messageId)))[0];
export const threadSummary = async (db: Db, row: ThreadRow) => summaryOf(row, (await latestStatuses(db, "owner", [row.id])).get(row.id) ?? null);

type NewMessage = { body: string; private?: boolean; context?: MessageContext; now?: Date };
/** A new thread, titled from its first message. The message is posted separately (postMessage). */
export async function createThread(db: Db, { body, private: hidden = false, now = new Date() }: NewMessage): Promise<ThreadRow> {
  const [row] = await db.insert(threads).values({ id: id(), title: threadTitle(body), private: hidden, createdAt: now, updatedAt: now }).returning();
  return row;
}
/**
 * Adds a message, or returns null when the thread does not exist. Everything in a private thread is private. A private
 * message in a public thread leaves the thread's public `updatedAt` alone.
 */
export async function postMessage(db: Db, { threadId, role, body, private: hidden = false, context, runId, now = new Date() }: NewMessage & { threadId: string; role: Role; runId?: string }): Promise<MessageRow | null> {
  const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
  if (!thread) return null;
  const secret = hidden || thread.private;
  // Messages of a thread are ordered by time, so a message is never stamped at or before the one it follows.
  const [last] = await db.select({ at: messages.createdAt }).from(messages).where(eq(messages.threadId, threadId)).orderBy(desc(messages.createdAt)).limit(1);
  const createdAt = last && last.at >= now ? new Date(last.at.getTime() + 1) : now;
  const [row] = await db.insert(messages).values({ id: id(), threadId, role, body, private: secret, context: context ?? null, runId: runId ?? null, createdAt }).returning();
  if (!secret || thread.private) await db.update(threads).set({ updatedAt: now }).where(eq(threads.id, threadId));
  return row;
}

const count = async (db: Db, where: SQL | undefined) => (await db.select({ n: sql<number>`count(*)::int` }).from(runs).where(where))[0].n;
const codeRunsSince = (now: Date) => and(eq(runs.lane, "code"), gte(runs.createdAt, new Date(now.getTime() - DAY_MS)));
/** Throws StudioLimit when too many runs are waiting, or (code lane) when 30 code-lane runs started in the last 24 hours. */
export async function checkCaps(db: Db, lane: Lane = "fast", now = new Date()) {
  if (await count(db, eq(runs.status, "queued")) >= MAX_QUEUED) throw new StudioLimit("Too many requests are waiting. Let some finish first.");
  if (lane === "code" && await count(db, codeRunsSince(now)) >= CODE_RUNS_PER_DAY) throw new StudioLimit("The code lane has reached its limit for today.");
}
/**
 * Queues a run for an owner message and links the message to it. Every run starts queued; claimNextRun starts the oldest
 * one when nothing else is running. Throws StudioLimit (see checkCaps).
 */
export async function startRun(db: Db, { threadId, messageId, lane = "fast", now = new Date() }: { threadId: string; messageId: string; lane?: Lane; now?: Date }): Promise<RunRow> {
  await checkCaps(db, lane, now);
  const [row] = await db.insert(runs).values({ id: id(), threadId, messageId, lane, status: "queued", createdAt: now, heartbeatAt: now }).returning();
  await db.update(messages).set({ runId: row.id }).where(eq(messages.id, messageId));
  return row;
}
/**
 * Starts the oldest queued run if no run is running, and returns it; otherwise null. One statement: of two callers racing
 * for the same run, the second re-checks `status = 'queued'` against the first's committed row and gets nothing.
 */
export async function claimNextRun(db: Db, now = new Date()): Promise<RunRow | null> {
  const [row] = await db.update(runs).set({ status: "running", startedAt: now, heartbeatAt: now }).where(and(
    eq(runs.status, "queued"),
    sql`${runs.id} = (select q.id from runs q where q.status = 'queued' order by q.created_at, q.id limit 1)`,
    sql`not exists (select 1 from runs r where r.status = 'running')`,
  )).returning();
  return row ?? null;
}
/** Moves a running fast-lane run to the code lane, unless 30 code-lane runs already started in the last 24 hours (then null). */
export async function escalateRun(db: Db, runId: string, now = new Date()): Promise<RunRow | null> {
  const [row] = await db.update(runs).set({ lane: "code", heartbeatAt: now }).where(and(
    eq(runs.id, runId), eq(runs.status, "running"), eq(runs.lane, "fast"),
    sql`(select count(*) from runs c where c.lane = 'code' and c.created_at >= ${ts(new Date(now.getTime() - DAY_MS))}) < ${CODE_RUNS_PER_DAY}`,
  )).returning();
  return row ?? null;
}
/** Marks a run as alive. Anything that changes a run also does this, which is what `?after=` polling keys on. */
export const touchRun = async (db: Db, runId: string, now = new Date()) => { await db.update(runs).set({ heartbeatAt: now }).where(eq(runs.id, runId)); };
const endSteps = (db: Db, runIds: string[], state: StepState) => db.update(runSteps).set({ state }).where(and(inArray(runSteps.runId, runIds), eq(runSteps.state, "doing")));
/** Adds a line to the public checklist. The step before it, if still "doing", becomes "done". */
export async function addStep(db: Db, runId: string, text: string, { state = "doing", now = new Date() }: { state?: StepState; now?: Date } = {}) {
  await endSteps(db, [runId], "done");
  await db.insert(runSteps).values({ runId, seq: nextSeq("run_steps", runId), text: text.slice(0, 300), state, at: now });
  await touchRun(db, runId, now);
}
/** Sets the state of the step in progress (a tool call that failed). */
export const failStep = async (db: Db, runId: string, now = new Date()) => { await endSteps(db, [runId], "failed"); await touchRun(db, runId, now); };
/** Adds a line to the private log (owner only). */
export async function addLog(db: Db, runId: string, text: string, now = new Date()) {
  await db.insert(runLogs).values({ runId, seq: nextSeq("run_logs", runId), text: text.slice(0, 4000), at: now });
}
/** Merges fields into a run's result while it is still going (so a publish is recorded even if the run dies right after). */
export const noteResult = async (db: Db, runId: string, patch: RunResult, now = new Date()) => { await db.update(runs).set({ result: merged(patch), heartbeatAt: now }).where(eq(runs.id, runId)); };
/**
 * Ends a run that has not ended yet (queued, running, or waiting at needs_publish) and closes its checklist. Returns the
 * run, or null when it had already ended (so a late finish never overwrites a stop, a reap, or a revert).
 */
export async function finishRun(db: Db, runId: string, { status, summary, result, now = new Date() }: { status: "done" | "failed" | "stopped" | "needs_publish"; summary?: string; result?: RunResult; now?: Date }): Promise<RunRow | null> {
  const [row] = await db.update(runs).set({
    status, heartbeatAt: now, ...(status === "needs_publish" ? {} : { endedAt: now }), ...(summary ? { summary: summary.slice(0, 200) } : {}), ...(result ? { result: merged(result) } : {}),
  }).where(and(eq(runs.id, runId), inArray(runs.status, status === "needs_publish" ? ["queued", "running"] : ["queued", "running", "needs_publish"]))).returning();
  if (row) await endSteps(db, [runId], status === "failed" ? "failed" : "done");
  return row ?? null;
}
/** Stop: a queued run ends at once; a running one is flagged and ends at its next step. Returns the run as it now is. */
export async function requestStop(db: Db, runId: string, now = new Date()): Promise<RunRow | null> {
  const [stopped] = await db.update(runs).set({ status: "stopped", endedAt: now, heartbeatAt: now }).where(and(eq(runs.id, runId), eq(runs.status, "queued"))).returning();
  if (stopped) return stopped;
  const [flagged] = await db.update(runs).set({ stopRequested: true, heartbeatAt: now }).where(and(eq(runs.id, runId), eq(runs.status, "running"))).returning();
  return flagged ?? (await getRun(db, runId)) ?? null;
}
export const stopRequested = async (db: Db, runId: string) => Boolean((await db.select({ stop: runs.stopRequested }).from(runs).where(eq(runs.id, runId)))[0]?.stop);
/** done | failed | stopped → reverted, once. Null when the run was not in one of those states. */
export async function markReverted(db: Db, runId: string, { result, now = new Date() }: { result?: RunResult; now?: Date } = {}): Promise<RunRow | null> {
  const [row] = await db.update(runs).set({ status: "reverted", heartbeatAt: now, ...(result ? { result: merged(result) } : {}) }).where(and(eq(runs.id, runId), inArray(runs.status, ["done", "failed", "stopped"]))).returning();
  return row ?? null;
}
/** Fails every running run whose heartbeat is older than 15 minutes (its function or sandbox died). Returns their ids. */
export async function reapStaleRuns(db: Db, now = new Date()): Promise<string[]> {
  const reaped = await db.update(runs).set({ status: "failed", endedAt: now, heartbeatAt: now, result: merged({ error: STALE_ERROR }) })
    .where(and(eq(runs.status, "running"), or(lt(runs.heartbeatAt, new Date(now.getTime() - STALE_MS)), sql`${runs.heartbeatAt} is null`))).returning({ id: runs.id });
  const ids = reaped.map((row) => row.id);
  if (ids.length) await endSteps(db, ids, "failed");
  return ids;
}
/** True when runs are waiting and nothing is running: someone should claim the next one. */
export async function queueIdle(db: Db): Promise<boolean> {
  const active = await db.select({ status: runs.status }).from(runs).where(inArray(runs.status, ["queued", "running"]));
  return active.length > 0 && !active.some((row) => row.status === "running");
}
/**
 * The conversation a run answers, oldest first with the run's own message last, at most 40 messages. Owner messages posted
 * after it are left out (their runs are still queued behind this one); replies to earlier messages are kept even when
 * they arrived after it was posted. When the run's message is public, private messages are left out, so a public reply
 * cannot repeat something private.
 */
export async function history(db: Db, run: { threadId: string; messageId: string }): Promise<MessageRow[]> {
  const trigger = await getMessage(db, run.messageId);
  if (!trigger) return [];
  const rows = await db.select().from(messages).where(and(eq(messages.threadId, run.threadId), trigger.private ? undefined : eq(messages.private, false))).orderBy(asc(messages.createdAt), asc(messages.id));
  return [...rows.filter((row) => row.id !== trigger.id && (row.role === "claude" || row.createdAt < trigger.createdAt)), trigger].slice(-40);
}
