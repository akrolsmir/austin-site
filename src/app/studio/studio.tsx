"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { safeUrl } from "@/lib/types";
import { MAX_MESSAGE_CHARS, isActive, type AskContext, type CreatedThreadResponse, type MessageContext, type MessageView, type PostedMessageResponse, type RunResponse, type RunView, type ThreadResponse, type ThreadSummary, type ThreadsResponse } from "@/lib/studio/types";
import { ago, bumpThread, contextLabel, laneLabel, mergeById, mergeThread, pollDelay, resultLine, routeOf, segments, shouldPoll, statusLabel, threadNote, took, type Held } from "./logic";

// The whole /studio UI: thread list, conversation, run cards, composer. Contract: docs/editable-site.md, "Studio"; API shapes in
// src/lib/studio/types.ts. The server page hands over what the viewer may see; this refreshes it from /api/studio, polls every
// 1.5 s only while a run is going, and refreshes when the tab regains focus. Every string from the API (messages, steps,
// summaries, errors, paths) is rendered as a React text node, and every link goes through safeUrl.
export type Initial = { configured: boolean; owner: boolean; now: number; threads: ThreadSummary[]; held: Held | null; missing: boolean; failed: boolean };
type Problem = { id: string; kind: "missing" } | null;
type Pending = { body: string; private: boolean; context?: MessageContext; threadId: string | null };
type Action = "stop" | "revert" | "publish";

class Failure extends Error { constructor(public status: number, message: string) { super(message); } }
async function call<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new Failure(0, "Couldn't reach the site. Check your connection and try again."); }
  const data: unknown = await response.json().catch(() => null), error = (data as { error?: unknown } | null)?.error;
  if (!response.ok || data === null) throw new Failure(response.status, typeof error === "string" && error ? error : "Something went wrong. Try again.");
  return data as T;
}
const said = (error: unknown) => error instanceof Failure ? error.message : "Something went wrong. Try again.";
const without = <T,>(map: Record<string, T>, key: string) => Object.fromEntries(Object.entries(map).filter(([id]) => id !== key)) as Record<string, T>;
const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

const Icon = ({ d, size = 14 }: { d: string; size?: number }) => <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const PATHS = { check: "M3.5 8.5l3 3 6-7", cross: "M4.5 4.5l7 7m0-7l-7 7", back: "M9.5 3.5L5 8l4.5 4.5", plus: "M8 3.5v9M3.5 8h9", lock: "M4.5 7.5h7v5h-7zM6 7.5V5.5a2 2 0 0 1 4 0v2", clock: "M8 5v3.2l2 1.3M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z", undo: "M5.5 3.500L3 6l2.5 2.500M3 6h6a3.5 3.5 0 0 1 0 7H6.5", out: "M6.5 3.500h6v6M12.5 3.500l-7 7" };
/** The site's asterisk: Claude's mark beside its replies, and (turning) the sign that a step is under way. */
const Asterisk = ({ size = 14, turning = false }: { size?: number; turning?: boolean }) => <svg className={turning ? "studio-turning" : undefined} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 2v12M2.8 5l10.4 6M13.2 5L2.8 11" /></svg>;

/** Message text: line breaks kept by CSS, URLs linked through safeUrl, `code` set in the code face. Never HTML. */
const Rich = ({ text }: { text: string }) => <>{segments(text).map((part, index) => part.kind === "link" ? <a key={index} href={part.href} rel="noopener noreferrer nofollow" target="_blank">{part.text}</a> : part.kind === "code" ? <code key={index}>{part.text}</code> : part.text)}</>;
const ContextChip = ({ context, onRemove }: { context: MessageContext; onRemove?: () => void }) => {
  const { where, quote } = contextLabel(context);
  return <span className="studio-chip"><span className="studio-chip-where">About {where}</span>{quote && <span className="studio-chip-quote">“{quote}”</span>}{onRemove && <button type="button" className="studio-chip-x" onClick={onRemove} aria-label="Remove the attached context"><Icon d={PATHS.cross} size={12} /></button>}</span>;
};

function RunCard({ run, owner, now, busy, error, onAct }: { run: RunView; owner: boolean; now: number; busy: Action | undefined; error: string | undefined; onAct: (run: RunView, action: Action) => void }) {
  const [confirming, setConfirming] = useState(false);
  const active = isActive(run.status), line = resultLine(run), time = took(run, now), result = run.result ?? {}, guarded = result.guarded ?? [];
  const mark = run.status === "running" ? <Asterisk turning /> : run.status === "queued" ? <Icon d={PATHS.clock} /> : run.status === "done" ? <Icon d={PATHS.check} /> : run.status === "reverted" ? <Icon d={PATHS.undo} /> : run.status === "needs_publish" ? <Icon d={PATHS.clock} /> : <Icon d={PATHS.cross} />;
  const links = ([[safeUrl(result.prUrl), result.prNumber ? `Pull request #${result.prNumber}` : "Pull request"], [safeUrl(result.previewUrl), "Preview"]] as const).filter((entry): entry is [string, string] => Boolean(entry[0]));
  const can = owner ? run.can : { stop: false, revert: false, publish: false };
  // A question answered without a step, a change or a button needs no card: Claude's reply says it all.
  if (run.status === "done" && !run.steps.length && !line && !links.length && !can.revert && !(owner && run.logs?.length)) return null;
  return <article className="studio-run" data-status={run.status} aria-label={`${laneLabel(run.lane)}: ${statusLabel(run)}`}>
    <header className="studio-run-head">
      <span className="studio-run-status" role="status">{mark}<span>{statusLabel(run)}</span>{time && run.status !== "queued" && run.status !== "needs_publish" && <span className="studio-run-time">{active ? time : `in ${time}`}</span>}</span>
      <span className="studio-badge">{laneLabel(run.lane)}</span>
    </header>
    {run.steps.length > 0 && <ol className="studio-steps">{run.steps.map((step) => <li key={step.seq} data-state={step.state}>{step.state === "doing" ? active ? <Asterisk size={12} turning /> : <Icon d={PATHS.cross} size={12} /> : <Icon d={step.state === "done" ? PATHS.check : PATHS.cross} size={12} />}<span>{step.text}</span></li>)}</ol>}
    {run.status === "queued" && <p className="studio-run-line">Waiting for the run ahead of it to finish.</p>}
    {line && <p className="studio-run-line studio-run-result">{line}</p>}
    {run.status === "needs_publish" && <div className="studio-guard">
      <p>{guarded.length ? "It touches files that guard the site, so it waits for Austin to publish it:" : "It waits for Austin to publish it."}</p>
      {guarded.length > 0 && <ul>{guarded.map((path) => <li key={path}><code>{path}</code></li>)}</ul>}
    </div>}
    {links.length > 0 && <p className="studio-run-links">{links.map(([href, label]) => <a key={label} href={href} target="_blank" rel="noopener noreferrer">{label}<Icon d={PATHS.out} size={12} /></a>)}</p>}
    {(can.stop || can.revert || can.publish) && <div className="studio-run-actions">
      {can.publish && <button type="button" className="studio-button" disabled={Boolean(busy)} aria-busy={busy === "publish"} onClick={() => onAct(run, "publish")}>{busy === "publish" ? "Publishing…" : "Publish"}</button>}
      {can.stop && <button type="button" className="studio-button studio-quiet" disabled={Boolean(busy) || run.stopRequested} aria-busy={busy === "stop"} onClick={() => onAct(run, "stop")}>{busy === "stop" || run.stopRequested ? "Stopping…" : "Stop"}</button>}
      {can.revert && !confirming && <button type="button" className="studio-button studio-quiet" disabled={Boolean(busy)} aria-busy={busy === "revert"} onClick={() => setConfirming(true)}>{busy === "revert" ? "Reverting…" : "Revert"}</button>}
      {can.revert && confirming && <><span className="studio-confirm">{run.lane === "fast" ? "Put the site back to before this change? Later quick edits are undone too." : "Undo this change with a new commit?"}</span><button type="button" className="studio-button" autoFocus onClick={() => { setConfirming(false); onAct(run, "revert"); }}>Revert</button><button type="button" className="studio-button studio-quiet" onClick={() => setConfirming(false)}>Keep it</button></>}
    </div>}
    {error && <p className="studio-note" role="alert">{error}</p>}
    {owner && run.logs && run.logs.length > 0 && <details className="studio-logs"><summary>Log, visible only to you</summary><pre>{run.logs.map((log) => log.text).join("\n")}</pre></details>}
  </article>;
}

function Composer({ fresh, privateThread, disabledWhy, sending, error, context, onRemoveContext, onSend, draft, setDraft }: { fresh: boolean; privateThread: boolean; disabledWhy: string; sending: boolean; error: string; context: MessageContext | null; onRemoveContext: () => void; onSend: (body: string, hidden: boolean) => void; draft: string; setDraft: (value: string) => void }) {
  const [hidden, setHidden] = useState(false), box = useRef<HTMLTextAreaElement>(null);
  const over = draft.trim().length > MAX_MESSAGE_CHARS, off = Boolean(disabledWhy) || sending, ready = !off && !over && draft.trim().length > 0;
  useEffect(() => { const area = box.current; if (!area) return; area.style.height = "auto"; area.style.height = `${Math.min(area.scrollHeight + 2, 220)}px`; }, [draft]);
  const submit = (event?: FormEvent) => { event?.preventDefault(); if (ready) onSend(draft.trim(), privateThread || hidden); };
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } };
  const note = error || (over ? `Messages can be at most ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters. This one is ${draft.trim().length.toLocaleString("en-US")}.` : "");
  return <form className="studio-composer" onSubmit={submit} aria-label={fresh ? "Start a thread" : "Reply"}>
    {context && <div className="studio-composer-context"><ContextChip context={context} onRemove={sending ? undefined : onRemoveContext} /></div>}
    <div className="studio-field" data-off={off || undefined}>
      <textarea ref={box} rows={fresh ? 3 : 1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={keys} disabled={Boolean(disabledWhy)} readOnly={sending} placeholder={disabledWhy ? "" : fresh ? "Ask for a change, or ask a question about the site" : "Reply, or ask for something else"} aria-label="Message" aria-describedby="studio-composer-hint" enterKeyHint="send" />
      <div className="studio-composer-row">
        {privateThread ? <span className="studio-private-fixed"><Icon d={PATHS.lock} size={13} />Private thread. Only you can see it.</span> : <label className="studio-switch"><input type="checkbox" role="switch" checked={hidden} onChange={(event) => setHidden(event.target.checked)} disabled={off} /><span className="studio-switch-track" aria-hidden="true" /><span className="studio-switch-text"><span>Private</span><span className="studio-switch-hint">{hidden ? fresh ? "Only you will see this thread." : "Only you will see this message and its reply." : fresh ? "Anyone can read this thread." : "Anyone can read this message."}</span></span></label>}
        <button type="submit" className="studio-button" disabled={!ready} aria-busy={sending}>{sending ? "Sending…" : "Send"}</button>
      </div>
    </div>
    <p className={disabledWhy ? "studio-composer-hint" : "studio-composer-hint studio-keys"} id="studio-composer-hint">{disabledWhy || "Enter sends. Shift+Enter starts a new line."}</p>
    <p className="studio-note" role="alert">{note}</p>
  </form>;
}

export function Studio({ initial, ask }: { initial: Initial; ask: AskContext | null }) {
  const pathname = usePathname() ?? "/studio", route = routeOf(pathname);
  const [configured, setConfigured] = useState(initial.configured), [owner, setOwner] = useState(initial.owner), [threads, setThreads] = useState(initial.threads);
  const [held, setHeld] = useState<Held | null>(initial.held), [problem, setProblem] = useState<Problem>(initial.missing && route.view === "thread" ? { id: route.id, kind: "missing" } : null);
  const [failures, setFailures] = useState(initial.failed ? 1 : 0), [loaded, setLoaded] = useState(!initial.failed), [beat, setBeat] = useState(0), [now, setNow] = useState(initial.now);
  const [draft, setDraft] = useState(""), [context, setContext] = useState<MessageContext | null>(ask), [pending, setPending] = useState<Pending | null>(null), [sendError, setSendError] = useState("");
  const [acting, setActing] = useState<Record<string, Action>>({}), [actErrors, setActErrors] = useState<Record<string, string>>({});
  const wanted = useRef<string | null>(null), latest = useRef({ id: null as string | null, at: undefined as string | undefined, last: 0 }), end = useRef<HTMLDivElement>(null), nearEnd = useRef(true), follow = useRef(false);

  // What the pane shows. A visitor at /studio (or /studio/new, which is the owner's) reads the newest thread.
  const composing = owner && (route.view === "new" || route.view === "index");
  const shownId = route.view === "thread" ? route.id : route.view === "missing" || composing ? null : threads[0]?.id ?? null;
  const shown = held && held.thread.id === shownId ? held : null, missing = route.view === "missing" || (problem !== null && problem.id === shownId);
  const active = shouldPoll(shown, threads), sending = pending !== null;

  const sync = useCallback(async (id: string | null, after?: string) => {
    latest.current.last = Date.now();
    // The list and the open thread are read side by side; whatever arrives is kept even when the other request fails.
    const [list, detail] = await Promise.allSettled([
      call<ThreadsResponse>("/api/studio/threads"),
      id ? call<ThreadResponse>(`/api/studio/threads/${id}${after ? `?after=${encodeURIComponent(after)}` : ""}`).catch((error: unknown) => { if (error instanceof Failure && error.status === 404) return "missing" as const; throw error; }) : null,
    ]);
    if (list.status === "fulfilled") { setConfigured(list.value.configured); setThreads(list.value.threads); setLoaded(true); if (list.value.configured) setOwner(list.value.owner); }
    const read = detail.status === "fulfilled" ? detail.value : null;
    if (read === "missing") setProblem({ id: id!, kind: "missing" });
    else if (read) { setHeld((had) => wanted.current === id ? mergeThread(had?.thread.id === id ? had : null, read) : had); setProblem((had) => had?.id === id ? null : had); }
    const failed = list.status === "rejected" || detail.status === "rejected";
    setFailures((count) => failed ? count + 1 : 0); setNow(Date.now());
  }, []);

  useEffect(() => { wanted.current = shownId; latest.current.id = shownId; latest.current.at = shown?.at; });
  // Who is looking: /api/me also sets or clears the editor hint cookie.
  useEffect(() => { void call<{ owner: unknown }>("/api/me").then((me) => setOwner(Boolean(me.owner))).catch(() => undefined); }, []);
  // Opening a thread (and the first render) reads it whole.
  useEffect(() => { void sync(shownId); }, [shownId, sync]);
  // Poll only while a run is going, slower while requests fail, and not at all in a hidden tab.
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => { void (document.hidden ? Promise.resolve() : sync(latest.current.id, latest.current.at)).then(() => setBeat((count) => count + 1)); }, pollDelay(failures));
    return () => clearTimeout(timer);
  }, [active, beat, failures, sync]);
  // Coming back to the tab refreshes once; a clock tick keeps the relative times honest.
  useEffect(() => {
    const refresh = () => { if (document.hidden || Date.now() - latest.current.last < 5000) return; void sync(latest.current.id, latest.current.at); };
    const clock = setInterval(() => setNow(Date.now()), 30000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(clock); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [sync]);
  // Keep the newest line in view while the reader is already at the end, and after the owner sends or opens a thread.
  useEffect(() => {
    const track = () => { nearEnd.current = !end.current || end.current.getBoundingClientRect().top - window.innerHeight < 140; };
    track(); window.addEventListener("scroll", track, { passive: true });
    return () => window.removeEventListener("scroll", track);
  }, []);
  const stepCount = shown?.runs.reduce((sum, run) => sum + run.steps.length, 0) ?? 0, lastStatus = shown?.runs.at(-1)?.status;
  useEffect(() => { if (owner && shownId) follow.current = true; }, [owner, shownId]);
  useEffect(() => {
    if (!shown && !pending) return;
    if (follow.current || nearEnd.current) end.current?.scrollIntoView({ block: "end", behavior: follow.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (shown) follow.current = false;
  }, [shown?.thread.id, shown?.messages.length, stepCount, lastStatus, pending]); // eslint-disable-line react-hooks/exhaustive-deps -- scroll when the conversation grows, not on every poll

  const go = (path: string) => { window.history.pushState(null, "", path); window.scrollTo(0, 0); };
  const link = (path: string) => ({ href: path, onClick: (event: MouseEvent) => { if (plainClick(event)) { event.preventDefault(); go(path); } } });
  const dropContext = () => { setContext(null); if (window.location.search) window.history.replaceState(null, "", window.location.pathname); };

  async function send(body: string, hidden: boolean) {
    const threadId = shown?.thread.id ?? null, attached = context ?? undefined;
    setPending({ body, private: hidden, context: attached, threadId }); setSendError(""); setDraft(""); follow.current = true;
    try {
      const payload = { body, private: hidden, ...(attached ? { context: attached } : {}) };
      if (threadId) {
        const { message, run } = await call<PostedMessageResponse>(`/api/studio/threads/${threadId}/messages`, payload);
        setHeld((had) => had && had.thread.id === threadId ? { ...had, thread: { ...had.thread, status: run.status }, messages: mergeById(had.messages, [message]), runs: mergeById(had.runs, [run]) } : had);
        setThreads((list) => { const thread = list.find((entry) => entry.id === threadId); return thread ? bumpThread(list, { ...thread, status: run.status, updatedAt: hidden && !thread.private ? thread.updatedAt : message.createdAt }) : list; });
      } else {
        const { thread, message, run } = await call<CreatedThreadResponse>("/api/studio/threads", payload);
        setThreads((list) => bumpThread(list, thread)); setHeld({ thread, messages: [message], runs: [run], at: message.createdAt });
        window.history.pushState(null, "", `/studio/${thread.id}`);
      }
      setContext(null); setNow(Date.now());
    } catch (error) { setDraft((typed) => typed || body); setSendError(said(error)); }
    finally { setPending(null); }
  }
  async function act(run: RunView, action: Action) {
    setActing((map) => ({ ...map, [run.id]: action })); setActErrors((map) => without(map, run.id));
    try {
      const { run: next } = await call<RunResponse>(`/api/studio/runs/${run.id}/${action}`, {});
      setHeld((had) => had && had.thread.id === next.threadId ? { ...had, runs: mergeById(had.runs, [next]) } : had);
      void sync(latest.current.id, latest.current.at);
    } catch (error) { setActErrors((map) => ({ ...map, [run.id]: said(error) })); }
    finally { setActing((map) => without(map, run.id)); }
  }

  const head = (lede: ReactNode) => <header className="studio-head"><h1>Studio</h1><p className="studio-lede">{lede}</p></header>;
  if (!configured) return <main id="content" className="studio studio-plain">
    {head("The studio isn't set up on this deployment.")}
    <p className="studio-foot">{owner ? "It needs a database before it can keep threads. Until then, edit the site with the editor bar." : "This is where Austin talks with his site. There is nothing to read here yet."}</p>
    {owner && <Composer fresh privateThread={false} disabledWhy="Sending is off until the studio has a database." sending={false} error="" context={null} onRemoveContext={dropContext} onSend={() => undefined} draft="" setDraft={() => undefined} />}
    <p className="studio-foot"><Link href="/">Back to the site</Link></p>
  </main>;

  const lede = owner ? "Ask for a change, or ask about the site. Claude makes quick edits straight away and opens a pull request for anything bigger." : "This is Austin talking with his site. He asks for changes, Claude makes them, and you can read along.";
  const retry = <button type="button" className="studio-button studio-quiet" onClick={() => void sync(shownId)}>Try again</button>;
  if (!owner && threads.length === 0 && route.view !== "thread" && route.view !== "missing") return <main id="content" className="studio studio-plain">
    {head(lede)}
    {failures > 0 ? <div className="studio-empty" role="alert"><p>Couldn&apos;t load the studio.</p>{retry}</div> : <p className="studio-foot">{loaded ? "No conversations yet. When Austin asks for a change in public, it will appear here." : "Loading…"}</p>}
  </main>;

  const listView = route.view === "index" && threads.length > 0 && !(composing && (context || pending));
  const bubble = (message: Pick<MessageView, "body" | "private" | "context"> & { createdAt?: string }, key: string, run?: RunView) => <li key={key} className="studio-turn studio-turn-owner" data-pending={message.createdAt ? undefined : true}>
    <div className="studio-bubble"><span className="studio-sr">Austin: </span><Rich text={message.body} /></div>
    <p className="studio-meta">{message.context && <ContextChip context={message.context} />}{message.private && !shown?.thread.private && <span className="studio-meta-private"><Icon d={PATHS.lock} size={12} />Private</span>}{message.createdAt ? <time dateTime={message.createdAt} title={message.createdAt}>{ago(message.createdAt, now)}</time> : <span>Sending…</span>}</p>
    {run && <RunCard run={run} owner={owner} now={now} busy={acting[run.id]} error={actErrors[run.id]} onAct={act} />}
  </li>;
  const turns = shown && <ol className="studio-turns">
    {shown.messages.map((message) => message.role === "owner" ? bubble(message, message.id, shown.runs.find((run) => run.messageId === message.id)) : <li key={message.id} className="studio-turn studio-turn-claude"><span className="studio-mark"><Asterisk size={15} /></span><div className="studio-reply"><span className="studio-sr">Claude: </span><Rich text={message.body} /></div></li>)}
    {pending && pending.threadId === shown.thread.id && bubble(pending, "pending")}
  </ol>;
  const back = threads.length > 0 && <a className="studio-back" {...link("/studio")}><Icon d={PATHS.back} />Threads</a>;
  const composer = (fresh: boolean) => <Composer key={fresh ? "new" : shown?.thread.id} fresh={fresh} privateThread={!fresh && Boolean(shown?.thread.private)} disabledWhy="" sending={sending} error={sendError} context={context} onRemoveContext={dropContext} onSend={send} draft={draft} setDraft={setDraft} />;

  return <main id="content" className="studio" data-view={listView ? "list" : "pane"}>
    {head(lede)}
    <div className="studio-body">
      <nav className="studio-list" aria-label="Threads">
        {owner && <a className="studio-new" aria-current={composing ? "page" : undefined} {...link("/studio/new")}><Icon d={PATHS.plus} />New thread</a>}
        {threads.length === 0 ? <p className="studio-list-empty">{loaded ? "No threads yet." : "Loading…"}</p> : <ul>{threads.map((thread) => { const note = threadNote(thread.status); return <li key={thread.id}><a className="studio-thread" aria-current={thread.id === shownId ? "page" : undefined} {...link(`/studio/${thread.id}`)}>
          <span className="studio-thread-title">{thread.title}</span>
          <span className="studio-thread-meta">{thread.status && isActive(thread.status) && <Asterisk size={11} turning={thread.status === "running"} />}{note && <span data-note={thread.status}>{note}</span>}<time dateTime={thread.updatedAt}>{ago(thread.updatedAt, now)}</time>{thread.private && <span className="studio-thread-private"><Icon d={PATHS.lock} size={12} /><span className="studio-sr">Private</span></span>}</span>
        </a></li>; })}</ul>}
      </nav>
      <section className="studio-pane" aria-label="Conversation">
        {missing ? <div className="studio-empty">{back}<h2>This thread isn&apos;t here</h2><p>It may be private, or the link may be wrong.</p>{threads.length > 0 && <p><a {...link("/studio")}>See all threads</a></p>}</div>
          : composing ? <>
            {back}
            <h2 className="studio-title">New thread</h2>
            {pending && pending.threadId === null ? <ol className="studio-turns">{bubble(pending, "pending")}</ol> : <p className="studio-hint">Say what should change in plain words, like “make the intro shorter” or “add a talks section”. Or ask a question and nothing changes.</p>}
            {composer(true)}
          </>
          : shown ? <>
            {back}
            <header className="studio-thread-head"><h2 className="studio-title">{shown.thread.title}</h2><p className="studio-meta">{shown.thread.private && <span className="studio-meta-private"><Icon d={PATHS.lock} size={12} />Private</span>}<span>Started <time dateTime={shown.thread.createdAt} title={shown.thread.createdAt}>{ago(shown.thread.createdAt, now)}</time></span></p></header>
            {turns}
            {shown.messages.length === 0 && !pending && <p className="studio-hint">Nothing in this thread is public yet.</p>}
            {failures >= 2 && <p className="studio-offline" role="status"><Asterisk size={12} turning />Connection lost. Trying again.</p>}
            {owner ? <div className="studio-dock">{composer(false)}</div> : <p className="studio-readonly">You&apos;re reading along. Only Austin can write here.</p>}
          </>
          : failures > 0 ? <div className="studio-empty" role="alert">{back}<p>Couldn&apos;t load this conversation.</p>{retry}</div>
          : <div className="studio-empty studio-loading" role="status">{back}<p>Loading…</p></div>}
        <div ref={end} />
      </section>
    </div>
  </main>;
}
