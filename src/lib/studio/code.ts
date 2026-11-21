import type { Db } from "../../db";
import { addLog, finishRun, type RunRow } from "./store";

// STUB for the code lane (docs/editable-site.md, "Code lane"): the signatures the fast lane and the routes call, with
// their dependencies injected. Each one currently ends the run with CODE_LANE_UNAVAILABLE. The code-lane agent replaces the
// bodies (Vercel Sandbox, scripts/studio-runner.ts, GitHub) and adds /api/studio/runner; callers should not need to change.
export const CODE_LANE_UNAVAILABLE = "The code lane isn't set up yet.";
export type CodeDeps = { db: Db; env?: Record<string, string | undefined>; fetch?: typeof fetch; now?: () => Date; revalidate?: () => void; origin?: string };
export type CodeRun = Pick<RunRow, "id" | "threadId" | "messageId">;
/** `error` is a sentence that is safe to show to anyone. */
export type CodeOutcome = { ok: true } | { ok: false; error: string };

async function unavailable({ db, now = () => new Date() }: CodeDeps, run: CodeRun, what: string): Promise<CodeOutcome> {
  await addLog(db, run.id, `${what}: the code lane is a stub.`, now());
  await finishRun(db, run.id, { status: "failed", result: { error: CODE_LANE_UNAVAILABLE }, now: now() });
  return { ok: false, error: CODE_LANE_UNAVAILABLE };
}
/**
 * Takes over a run that is "running" with lane "code" (the fast lane escalated it with `brief`, or a queued code-lane run
 * was claimed, in which case there is no brief and the thread is the brief). Returns once the work is handed off; the run
 * stays "running" (heartbeats and steps come in through /api/studio/runner) until the lane finishes it.
 */
export const startCodeRun = (deps: CodeDeps, run: CodeRun, brief?: string): Promise<CodeOutcome> => unavailable(deps, run, `startCodeRun${brief ? ` (${brief.length} character brief)` : ""}`);
/** The owner approved a run waiting at "needs_publish": merge it and finish the run. */
export const publishCodeRun = (deps: CodeDeps, run: CodeRun): Promise<CodeOutcome> => unavailable(deps, run, "publishCodeRun");
/** Reverts a merged code-lane run (a revert PR of `result.mergeSha`, merged at once) and marks it "reverted". */
export const revertCodeRun = (deps: CodeDeps, run: CodeRun): Promise<CodeOutcome> => unavailable(deps, run, "revertCodeRun");
