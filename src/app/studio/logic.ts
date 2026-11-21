import { safeUrl } from "../../lib/types";
import { isActive, type Iso, type Lane, type MessageContext, type MessageView, type RunStatus, type RunView, type ThreadResponse, type ThreadSummary } from "../../lib/studio/types";

// The /studio UI's pure logic (no React, no DOM), so tests can run it: what a URL shows, how poll results merge into what
// the page holds, how message text is split into plain text, links and inline code, and the words for times and states.
// Contract: docs/editable-site.md, "Studio"; API shapes in src/lib/studio/types.ts.

export const POLL_MS = 1500, MAX_POLL_MS = 12000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What a /studio path shows: the index, the new-thread composer, one thread, or nothing we know. */
export type Route = { view: "index" } | { view: "new" } | { view: "thread"; id: string } | { view: "missing" };
export function routeOf(pathname: string): Route {
  const parts = pathname.replace(/[?#].*$/, "").split("/").filter(Boolean);
  if (parts[0] !== "studio" || parts.length > 2) return { view: "missing" };
  if (parts.length === 1) return { view: "index" };
  if (parts[1] === "new") return { view: "new" };
  return ID.test(parts[1]) ? { view: "thread", id: parts[1] } : { view: "missing" };
}

/** A thread as the page holds it: every message and run seen so far, oldest first, and the cursor for the next poll. */
export type Held = { thread: ThreadSummary; messages: MessageView[]; runs: RunView[]; at: Iso };
const byTime = <T extends { id: string; createdAt: Iso }>(a: T, b: T) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
/** Merges entries into a list by `id` (the incoming copy wins, entries may repeat) and keeps it oldest first. */
export function mergeById<T extends { id: string; createdAt: Iso }>(held: readonly T[], incoming: readonly T[]): T[] {
  if (!incoming.length) return held as T[];
  const all = new Map(held.map((entry) => [entry.id, entry]));
  for (const entry of incoming) all.set(entry.id, entry);
  return [...all.values()].sort(byTime);
}
/** Folds a full read or a `?after=` poll into what the page holds. A response for another thread, or without one, changes nothing. */
export function mergeThread(held: Held | null, response: ThreadResponse): Held | null {
  if (!response.thread) return held;
  if (!held || held.thread.id !== response.thread.id) return { thread: response.thread, messages: mergeById([], response.messages), runs: mergeById([], response.runs), at: response.at };
  return { thread: response.thread, messages: mergeById(held.messages, response.messages), runs: mergeById(held.runs, response.runs), at: response.at > held.at ? response.at : held.at };
}
/** Puts one thread first in the list (new activity), replacing its older copy. */
export const bumpThread = (threads: readonly ThreadSummary[], thread: ThreadSummary): ThreadSummary[] => [thread, ...threads.filter((other) => other.id !== thread.id)];
/** Poll only while something in view is still going: a run of the open thread, or a thread in the list whose newest run is. */
export const shouldPoll = (held: Held | null, threads: readonly ThreadSummary[]) => Boolean(held?.runs.some((run) => isActive(run.status))) || threads.some((thread) => thread.status !== null && isActive(thread.status));
/** How long to wait before the next poll: 1.5 s, backing off (to 12 s at most) while requests keep failing. */
export const pollDelay = (failures: number) => Math.min(MAX_POLL_MS, POLL_MS * 2 ** Math.max(0, Math.min(failures, 6)));

export type Segment = { kind: "text"; text: string } | { kind: "code"; text: string } | { kind: "link"; text: string; href: string };
const TOKEN = /`([^`\n]+)`|https?:\/\/[^\s<>"`]+/g;
/** Trailing punctuation belongs to the sentence, not the URL; a closing bracket stays only when the URL opened one. */
function trimUrl(raw: string) {
  let url = raw;
  for (;;) {
    const last = url.at(-1)!;
    if (/[.,;:!?'*_~…]/.test(last)) url = url.slice(0, -1);
    else if (")]}".includes(last) && url.split(last).length > url.split("([{"[")]}".indexOf(last)]).length) url = url.slice(0, -1);
    else return url;
  }
}
/**
 * Splits a message into plain text, `inline code`, and http(s) links (each passed through safeUrl; anything it rejects stays
 * text). The pieces are rendered as React text nodes, never as HTML, and joined back together they are the original message.
 */
export function segments(body: string): Segment[] {
  const out: Segment[] = [];
  const text = (value: string) => { if (!value) return; const last = out.at(-1); if (last?.kind === "text") last.text += value; else out.push({ kind: "text", text: value }); };
  let from = 0;
  for (const match of body.matchAll(TOKEN)) {
    text(body.slice(from, match.index));
    from = match.index + match[0].length;
    if (match[1] !== undefined) { out.push({ kind: "code", text: match[1] }); continue; }
    const shown = trimUrl(match[0]), href = safeUrl(shown);
    if (!href) { text(match[0]); continue; }
    out.push({ kind: "link", text: shown, href });
    text(match[0].slice(shown.length));
  }
  text(body.slice(from));
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A short relative time. Computed from a `now` the server hands the page (and the page then advances), so both render the same words. */
export function ago(iso: Iso, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  if (minutes < 7 * 24 * 60) { const days = Math.floor(minutes / (24 * 60)); return days === 1 ? "yesterday" : `${days} days ago`; }
  const date = new Date(then), year = date.getUTCFullYear();
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}${year === new Date(now).getUTCFullYear() ? "" : `, ${year}`}`;
}
/** How long a run took (or has taken so far), e.g. "4 s", "1 min 20 s". Empty until it starts. */
export function took(run: Pick<RunView, "startedAt" | "endedAt">, now: number): string {
  const start = run.startedAt ? Date.parse(run.startedAt) : NaN, end = run.endedAt ? Date.parse(run.endedAt) : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return "";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  return minutes < 60 ? (rest ? `${minutes} min ${rest} s` : `${minutes} min`) : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export const laneLabel = (lane: Lane) => lane === "fast" ? "Quick edit" : "Code change";
export function statusLabel(run: Pick<RunView, "status" | "stopRequested"> & { result?: RunView["result"] }): string {
  if (run.stopRequested && run.status === "running") return "Stopping";
  if (run.status === "stopped" && run.result?.discarded) return "Discarded";
  return ({ queued: "Queued", running: "Working", done: "Done", failed: "Failed", stopped: "Stopped", needs_publish: "Ready to publish", reverted: "Reverted" } satisfies Record<RunStatus, string>)[run.status];
}
/** The few words a thread row adds after its time, or "" when the thread is at rest. */
export const threadNote = (status: RunStatus | null) => status === null ? "" : ({ queued: "Queued", running: "Working", done: "", failed: "Failed", stopped: "", needs_publish: "Ready to publish", reverted: "" } satisfies Record<RunStatus, string>)[status];
/** The one line under a run's checklist: what it did, why it failed, or what state it was left in. */
export function resultLine(run: Pick<RunView, "status" | "summary" | "result" | "lane">): string {
  if (run.status === "failed") return run.result?.error || "This run failed.";
  if (run.status === "reverted") return run.lane === "fast" ? "Reverted. The site is back to how it was before this change." : "Reverted. The change was undone with a new commit.";
  if (run.status === "stopped" && run.result?.discarded) return "Discarded. The pull request was closed without merging.";
  if (run.status === "stopped") return run.summary ? `${run.summary} Stopped before finishing.` : "Stopped before finishing.";
  if (run.status === "needs_publish") return run.summary || "The change is ready and has not been published.";
  return run.status === "done" ? run.summary ?? "" : "";
}
/**
 * Where a message was asked from, for the chip above the composer and under an owner message. `full` keeps the whole
 * quoted text: what is about to be sent with a message is shown to the owner in full, never a shortened version of it.
 */
export function contextLabel(context: MessageContext, full = false): { where: string; quote: string } {
  const where = context.slot ?? context.selector ?? context.route ?? "this page", quote = (context.text ?? "").replace(/\s+/g, " ").trim();
  return { where: context.slot && context.route ? `${context.slot} on ${context.route}` : where, quote: !full && quote.length > 80 ? `${quote.slice(0, 79).trimEnd()}…` : quote };
}
/** Whether a run's time belongs in its header ("Done in 4 s"): only while it works and for how it ended on its own. */
export const showsTime = (status: RunStatus) => status === "running" || status === "done" || status === "failed";
