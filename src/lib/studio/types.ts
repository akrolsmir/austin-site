// The studio API's JSON shapes: the contract between src/app/api/studio/** and the /studio UI. Pure (types, constants, and a
// few pure helpers; no server, db, or DOM imports), so client components may import it freely.
// Contract: docs/editable-site.md, "Studio".
//
// Every response is JSON with `Cache-Control: no-store`. Every failure is `{ error: string }` (StudioError) in plain words that
// are safe to show as they are, with one of these statuses: 400 (bad body), 401 (not the owner), 403 (cross-site request),
// 404 (no such thread or run, or one the viewer may not see), 409 (the run is not in a state that allows this), 413 (body too
// large), 415 (not JSON), 429 (a cap was hit), 500, 503 (the database, Blob storage, or the code lane is not set up).
// Writes need the owner's session, `Content-Type: application/json`, and a same-origin request. Reads are public: a viewer who
// is not the owner never receives private threads, private messages, `context`, a private message's run, or `logs`.
// Render every string here as text, never as HTML.
//
// GET  /api/studio/threads                  → ThreadsResponse. Threads newest activity first (at most 100).
// POST /api/studio/threads                  body NewMessageBody → 201 CreatedThreadResponse. Starts a thread (titled from the
//                                           message's first ~60 characters), posts the message, and queues its run.
// GET  /api/studio/threads/[id]             → ThreadResponse with every message and run of the thread, oldest first.
// GET  /api/studio/threads/[id]?after=<iso> → ThreadResponse with only the messages and runs that changed at or after `after`.
//                                           Pass the previous response's `at`. A changed run comes back whole (all its steps),
//                                           so merge messages and runs into what you hold by `id`; the same entry may repeat.
//                                           Poll every 1.5 s while any run is active (isActive), otherwise not at all.
// POST /api/studio/threads/[id]/messages    body NewMessageBody → 201 PostedMessageResponse. Posts a follow-up and queues its run.
// POST /api/studio/runs/[id]/stop           body {} → RunResponse. A queued run stops at once; a running one gets
//                                           `stopRequested` and ends as "stopped" at its next step. Already ended: returned as is.
// POST /api/studio/runs/[id]/revert         body {} → RunResponse with status "reverted". Allowed when `can.revert`. A fast-lane
//                                           run points the site back at the version published before it (later publishes
//                                           are undone with it); a code-lane run gets a revert commit.
// POST /api/studio/runs/[id]/publish        body {} → RunResponse. Approves a run waiting at "needs_publish" (`can.publish`).
// POST /api/studio/runs/[id]/discard        body {} → RunResponse with status "stopped" and `result.discarded`. Turns down a
//                                           run waiting at "needs_publish" (`can.discard`): its pull request is closed.
// GET  /api/studio/tick                     → { ok: true }. The scheduler tick (also run, throttled, by the two GETs above);
//                                           Vercel Cron calls it so runs move on when nobody has the studio open.
//
// When the database is not configured, the two GETs answer 200 with `configured: false` and an empty payload (show a quiet
// empty state) and every write answers 503. A thread that does not exist, or is private and the viewer is not the owner, is 404.
//
// How a run moves: queued → running → done | failed | stopped | needs_publish, needs_publish → done | failed | stopped, and
// done → reverted. Only one run is running at a time across the whole studio; later ones wait as "queued" and start by
// themselves, oldest first (a run waiting at "needs_publish" does not hold the queue). A run starts in the fast lane (lane
// "fast": answers, or publishes slot values within a few seconds) and may hand itself to the code lane (lane becomes
// "code": a branch, a preview, and a merge, automatic only for copy, theme, and style changes; anything else waits at
// "needs_publish" for the owner). Every message starts in the fast lane, also in a thread with an open code-lane run. A run that ends "done" usually has a "claude" message whose `runId`
// is the run; a run that ends "failed" has `result.error` instead, a sentence to show on its card.

export const MAX_MESSAGE_CHARS = 8000;
/** How both lanes reach the model: OpenRouter's Anthropic-compatible endpoint when OPENROUTER_API_KEY is set, else Anthropic directly. */
export const OPENROUTER_URL = "https://openrouter.ai/api";
export type ModelAccess = { key: string; openrouter: boolean; model: (id: string) => string };
/** OpenRouter names Anthropic models `anthropic/claude-sonnet-5.5`; ids that already carry a vendor pass through. */
export const openrouterModel = (id: string) => id.includes("/") ? id : `anthropic/${id.replace(/-(\d)-(\d)$/, "-$1.$2")}`;
export function modelAccess(env: Record<string, string | undefined>): ModelAccess | null {
  if (env.OPENROUTER_API_KEY) return { key: env.OPENROUTER_API_KEY, openrouter: true, model: openrouterModel };
  return env.ANTHROPIC_API_KEY ? { key: env.ANTHROPIC_API_KEY, openrouter: false, model: (id) => id } : null;
}
export const RUN_LANES = ["fast", "code"] as const;
export type Lane = (typeof RUN_LANES)[number];
export type RunStatus = "queued" | "running" | "done" | "failed" | "stopped" | "needs_publish" | "reverted";
export type StepState = "doing" | "done" | "failed";
export type Role = "owner" | "claude";
/** ISO 8601 timestamp, e.g. "2026-11-21T10:00:00.000Z". */
export type Iso = string;

/** Where "Ask Claude about this" was clicked. Owner only. */
export type MessageContext = { route?: string; slot?: string; selector?: string; text?: string };
/** What the editor encodes into `/studio?ask=`: base64url of this as JSON. */
export type AskContext = { route: string; slot?: string; text?: string };

export type ThreadSummary = {
  id: string; title: string; private: boolean; createdAt: Iso; updatedAt: Iso;
  /** Status of the thread's newest run the viewer may see, or null when it has none. */
  status: RunStatus | null;
};
export type MessageView = {
  id: string; threadId: string; role: Role; body: string; private: boolean; createdAt: Iso;
  /** For an owner message: the run it started. For a claude message: the run that wrote it. */
  runId: string | null;
  /** Present only for the owner, and only when the message carried one. */
  context?: MessageContext;
};
/** One line of a run's public checklist, in plain words ("Reading the homepage", "Publishing 2 changes"). */
export type StepView = { seq: number; text: string; state: StepState; at: Iso };
export type LogView = { seq: number; text: string; at: Iso };
/** What a run produced. Every field is optional; show what is there. */
export type RunResultView = {
  /** Fast lane: the overlay version this run published, and the one before it (absent when the site was on its defaults). */
  overlayHash?: string; previousOverlayHash?: string;
  /** Code lane. `guarded` lists the changed paths (at most 50) that made the run wait at "needs_publish"; `discarded` marks a run the owner turned down there. */
  branch?: string; prNumber?: number; prUrl?: string; mergeSha?: string; revertSha?: string; previewUrl?: string; guarded?: string[]; discarded?: boolean;
  /** Why the run failed, as one sentence for the run card. */
  error?: string;
};
export type RunView = {
  id: string; threadId: string; lane: Lane; status: RunStatus;
  /** The owner message that started the run. */
  messageId: string;
  /** One line on what the run did (a publish summary), or null. */
  summary: string | null;
  result: RunResultView | null;
  /** The owner pressed Stop and the run has not ended yet. */
  stopRequested: boolean;
  createdAt: Iso; startedAt: Iso | null; endedAt: Iso | null;
  /** The whole checklist, in order. */
  steps: StepView[];
  /** Which buttons make sense right now (same as runActions(run)). Show them to the owner only. */
  can: RunActions;
  /** Owner only: the private log, newest 100 lines in order. Absent for other viewers. */
  logs?: LogView[];
};
export type RunActions = { stop: boolean; revert: boolean; publish: boolean; discard: boolean };

/** `owner` says whether the viewer is the signed-in owner (show the composer and run buttons). */
export type ThreadsResponse = { configured: boolean; owner: boolean; threads: ThreadSummary[] };
export type ThreadResponse = {
  configured: boolean; owner: boolean;
  /** Null only when `configured` is false. */
  thread: ThreadSummary | null;
  messages: MessageView[]; runs: RunView[];
  /** Pass as `?after=` on the next poll. */
  at: Iso;
};
export type NewMessageBody = {
  /** 1 to MAX_MESSAGE_CHARS characters after trimming. */
  body: string;
  /** Hide the message, its run, and Claude's reply from everyone but the owner. On a new thread, the whole thread. */
  private?: boolean;
  context?: MessageContext;
};
export type CreatedThreadResponse = { thread: ThreadSummary; message: MessageView; run: RunView };
export type PostedMessageResponse = { message: MessageView; run: RunView };
export type RunResponse = { run: RunView };
export type StudioError = { error: string };

/** A run that is still going: keep polling while any run in view is active. */
export const isActive = (status: RunStatus) => status === "queued" || status === "running";
/** The buttons a run allows. Revert needs something to undo: a published overlay (fast lane) or a merge (code lane). */
export function runActions(run: { lane: Lane; status: RunStatus; result: RunResultView | null }): RunActions {
  const undoable = run.lane === "fast" ? Boolean(run.result?.overlayHash) && ["done", "failed", "stopped"].includes(run.status) : Boolean(run.result?.mergeSha) && run.status === "done";
  return { stop: isActive(run.status), revert: undoable, publish: run.status === "needs_publish", discard: run.status === "needs_publish" };
}
/** A thread's title: the first line or so of its first message. */
export function threadTitle(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= 60) return flat || "Untitled";
  const cut = flat.slice(0, 60), space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

const SLOT = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
/** Text Postgres can store: no NUL and no half of a surrogate pair (what cutting a string in the middle of an emoji leaves). */
export const storable = (text: string) => !text.includes("\u0000") && !LONE_SURROGATE.test(text);
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/;
const LIMITS = { route: 300, slot: 80, selector: 300, text: 500 } as const;
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** A path on this site: starts with one "/", no scheme, host, backslash, or control character. */
export const sitePath = (value: unknown): value is string => typeof value === "string" && value.length <= LIMITS.route && /^\/(?![/\\])/.test(value) && !/[\u0000- \u007f\\]/.test(value);
/**
 * Strictly validates a message context. Returns a clean copy with only the known keys, `undefined` for an absent or empty
 * context, and `null` for anything else (an unknown key, a wrong type, a value that is too long, a route that is not a path
 * on this site, a slot that is not a slot id, control characters).
 */
export function parseContext(value: unknown, keys: ReadonlyArray<keyof MessageContext> = ["route", "slot", "selector", "text"]): MessageContext | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (!plain(value) || Object.keys(value).some((key) => !(keys as readonly string[]).includes(key))) return null;
  const out: MessageContext = {};
  for (const key of keys) {
    const field = value[key];
    if (field === undefined) continue;
    if (typeof field !== "string" || !field || field.length > LIMITS[key] || CONTROL.test(field) || !storable(field)) return null;
    if (key === "route" && !sitePath(field)) return null;
    if (key === "slot" && !SLOT.test(field)) return null;
    if ((key === "selector" || key === "slot") && /[\n\t]/.test(field)) return null;
    out[key] = field;
  }
  return Object.keys(out).length ? out : undefined;
}
/**
 * Decodes the editor's `?ask=` parameter: base64url (no padding needed) of the JSON `{ route, slot?, text? }`. Returns null
 * unless it is exactly that: `route` is required and must be a path on this site, no other keys are accepted.
 */
export function decodeAsk(param: unknown): AskContext | null {
  if (typeof param !== "string" || !param || param.length > 4000 || !/^[A-Za-z0-9_-]+={0,2}$/.test(param)) return null;
  try {
    const binary = atob(param.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/"));
    const json = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    const context = parseContext(JSON.parse(json), ["route", "slot", "text"]);
    return context?.route ? { route: context.route, ...(context.slot ? { slot: context.slot } : {}), ...(context.text ? { text: context.text } : {}) } : null;
  } catch { return null; }
}
/**
 * The inverse of decodeAsk, for the editor's "Ask Claude about this" link: `/studio?ask=${encodeAsk(context)}`. The text is
 * made to fit what decodeAsk accepts: control characters become spaces, and it is cut to 500 characters by code point, so
 * an emoji is never cut in half.
 */
export function encodeAsk(context: AskContext): string {
  let text = "";
  for (const char of (context.text ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, " ").trim()) { if (!storable(char)) continue; if (text.length + char.length > LIMITS.text) break; text += char; }
  const bytes = new TextEncoder().encode(JSON.stringify({ route: context.route, ...(context.slot ? { slot: context.slot } : {}), ...(text ? { text } : {}) }));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/**
 * Whether a page request may carry `?ask=`: only a navigation from this site itself (the editor's own link). A link from
 * anywhere else could otherwise plant text in the owner's next message. Browsers say where a navigation came from in
 * Sec-Fetch-Site; one that does not send it is judged by its Referer.
 */
export function askAllowed(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  try { return new URL(headers.get("referer") ?? "").host === (headers.get("x-forwarded-host") ?? headers.get("host")); } catch { return false; }
}
