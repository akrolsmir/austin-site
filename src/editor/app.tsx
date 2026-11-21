import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import "./editor.css";
import { Field, Icon, useEd } from "./controls";
import { encodeAsk, relativeTime } from "./draft";
import { count, discard, getState, patch, publish, revert, setCollapsed, signOut, type State } from "./store";

// The editor's chrome: a floating bar, a side panel (Customize or History), the hover chip over editable text, and notices.
// Everything is styled from the site's own tokens (editor.css) and rendered in its own root, outside the page's React tree.
type NextWindow = { next?: { router?: { push?: (href: string) => void } } };
const go = (href: string) => { const router = (window as unknown as NextWindow).next?.router; if (href.startsWith("/") && router?.push) router.push(href); else window.location.assign(href); };
const ask = (slot?: string, text?: string) => go(`/studio?ask=${encodeAsk({ route: window.location.pathname, slot, text: text || window.getSelection()?.toString().trim() || undefined })}`);
// Where focus returns when the panel or menu closes.
let opener: HTMLElement | null = null;
function setView(view: State["view"], filter?: State["filter"]) {
  if (view && !getState().view) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  patch({ view, ...(filter ? { filter } : {}) });
  if (!view) { opener?.focus(); opener = null; }
}
const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "\u2318" : "Ctrl+";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Customize() {
  const slots = useEd((s) => s.slots), draft = useEd((s) => s.draft), filter = useEd((s) => s.filter), path = useEd((s) => s.path), n = Object.keys(draft).length;
  const groups = [...new Set(Object.values(slots).map((def) => def.group))], [open, setOpen] = useState<string[]>(() => [path === "/" ? "Home" : "Colors"]);
  const changed = Object.keys(slots).filter((id) => Object.hasOwn(draft, id));
  return <>
    <div className="ed-tabs" role="group" aria-label="Show">{(["all", "changed"] as const).map((key) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => patch({ filter: key })}>{key === "all" ? "Everything" : <>Changed{n > 0 && <span className="ed-count">{n}</span>}</>}</button>)}</div>
    <div className="ed-scroll">{filter === "changed"
      ? changed.length ? <div className="ed-fields">{changed.map((id) => <Field key={id} id={id} />)}</div> : <p className="ed-blank">Nothing waiting to be published. Click any text on the page to edit it, or change colours, type, and layout under Everything.</p>
      : groups.map((group) => { const ids = Object.keys(slots).filter((id) => slots[id].group === group), dirty = ids.filter((id) => Object.hasOwn(draft, id)).length, shown = open.includes(group); return <section key={group} className="ed-group" data-open={shown || undefined}>
        <h3><button type="button" aria-expanded={shown} onClick={() => setOpen(shown ? open.filter((name) => name !== group) : [...open, group])}>{Icon.chevron}<span>{group}</span>{dirty > 0 && <span className="ed-count" aria-label={`${plural(dirty, "unpublished change")}`}>{dirty}</span>}</button></h3>
        {shown && <div className="ed-fields">{ids.map((id) => <Field key={id} id={id} />)}</div>}
      </section>; })}</div>
  </>;
}

const SOURCES: Record<string, string> = { editor: "Editor", revert: "History", bake: "Code" };
function History() {
  const history = useEd((s) => s.history), current = useEd((s) => s.current), damaged = useEd((s) => s.damaged), busy = useEd((s) => s.busy), [now, setNow] = useState(() => Date.now()), [confirm, setConfirm] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const live = history.findIndex((version) => version.hash === current);
  return <div className="ed-scroll">
    {history.length === 0 ? <p className="ed-blank">Nothing has been published yet. Each time you publish, the version is kept here so you can go back to it.</p>
      : <ol className="ed-history">{history.map((version, index) => <li key={`${version.hash}-${version.at}`} data-live={index === live || undefined}>
        <div><p className="ed-version">{version.summary || "Edited"}</p><p className="ed-meta"><time dateTime={version.at} title={new Date(version.at).toLocaleString()}>{relativeTime(version.at, now)}</time><span>{SOURCES[version.by] ?? (version.by.startsWith("studio") ? "Studio" : version.by)}</span></p></div>
        {index === live ? <span className="ed-live">Live</span> : <button type="button" className="ed-button" disabled={!!busy} aria-label={`Revert to "${version.summary || "Edited"}" from ${relativeTime(version.at, now)}`} onClick={() => void revert(version.hash)}>Revert</button>}
      </li>)}</ol>}
    {(current !== null || damaged) && <div className="ed-defaults">{confirm
      ? <><p>Take every published change off the site? This version stays in the history.</p><div><button type="button" className="ed-button ed-primary" disabled={!!busy} onClick={() => { setConfirm(false); void revert(null); }}>Back to defaults</button><button type="button" className="ed-button" onClick={() => setConfirm(false)}>Cancel</button></div></>
      : <button type="button" className="ed-button" disabled={!!busy} onClick={() => setConfirm(true)}>Back to defaults</button>}</div>}
  </div>;
}

function Panel() {
  const view = useEd((s) => s.view), ref = useRef<HTMLElement>(null);
  useEffect(() => { if (view) ref.current?.focus({ preventScroll: true }); }, [view]);
  if (!view) return null;
  const name = view === "customize" ? "Customize" : "History";
  return <aside ref={ref} className="ed-panel" tabIndex={-1} aria-label={name}>
    <header><h2>{name}</h2><button type="button" className="ed-icon" aria-label={`Close ${name.toLowerCase()}`} onClick={() => setView(null)}>{Icon.close}</button></header>
    {view === "customize" ? <Customize /> : <History />}
  </aside>;
}

function Menu({ notionUrl }: { notionUrl: string | null }) {
  const [open, setOpen] = useState(false), busy = useEd((s) => s.busy), ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const away = (event: Event) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", away, true); window.addEventListener("focusin", away);
    return () => { window.removeEventListener("pointerdown", away, true); window.removeEventListener("focusin", away); };
  }, [open]);
  const close = () => { setOpen(false); ref.current?.querySelector<HTMLElement>(".ed-tool")?.focus(); };
  const step = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.stopPropagation(); return close(); }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])].filter((item) => item.offsetParent), at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };
  return <div className="ed-menu" ref={ref} onKeyDown={open ? step : undefined}>
    <button type="button" className="ed-tool" aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{Icon.more}</button>
    {open && <div className="ed-menu-list" role="menu" aria-label="More">
      {notionUrl && <a role="menuitem" className="ed-narrow" href={notionUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>Edit in Notion</a>}
      <button type="button" role="menuitem" onClick={() => { setOpen(false); setCollapsed(true); }}>Hide editor</button>
      <button type="button" role="menuitem" disabled={busy === "signout"} onClick={() => void signOut()}>{busy === "signout" ? "Signing out…" : "Sign out"}</button>
    </div>}
  </div>;
}

function Bar() {
  const n = useEd(count), view = useEd((s) => s.view), busy = useEd((s) => s.busy), notionUrl = useEd((s) => s.notionUrl), inStudio = /^\/studio(\/|$)/.test(useEd((s) => s.path));
  const toggle = (name: NonNullable<State["view"]>) => setView(view === name ? null : name, name === "customize" ? "all" : undefined);
  return <div className="ed-bar" role="toolbar" aria-label="Site editor">
    <button type="button" className="ed-tool ed-mark" aria-label="Hide editor" title="Hide editor" onClick={() => setCollapsed(true)}>{Icon.mark}</button>
    <button type="button" className="ed-status" data-none={n === 0 || undefined} onClick={() => setView("customize", n ? "changed" : "all")}>{n ? plural(n, "unpublished change") : "No unpublished changes"}</button>
    <span className="ed-sep" aria-hidden="true" />
    <button type="button" className="ed-tool" aria-label="Customize" aria-pressed={view === "customize"} onClick={() => toggle("customize")}>{Icon.sliders}<span>Customize</span></button>
    <button type="button" className="ed-tool" aria-label="History" aria-pressed={view === "history"} onClick={() => toggle("history")}>{Icon.clock}<span>History</span></button>
    {!inStudio && <button type="button" className="ed-tool" aria-label="Ask Claude about this page" onClick={() => ask()}>{Icon.ask}<span>Ask Claude</span></button>}
    {notionUrl && <a className="ed-tool ed-wide" href={notionUrl} target="_blank" rel="noopener noreferrer"><span>Edit in Notion</span>{Icon.out}</a>}
    <span className="ed-sep" aria-hidden="true" />
    {n > 0 && <button type="button" className="ed-button ed-quiet" disabled={!!busy} onClick={(event) => { const next = event.currentTarget.parentElement?.querySelector<HTMLElement>('[aria-label="Customize"]'); discard(); next?.focus(); }}>Discard</button>}
    <button type="button" className="ed-button ed-primary" disabled={!n || !!busy} onClick={() => void publish()}>{busy === "publish" ? "Publishing…" : "Publish"}{n > 0 && busy !== "publish" && <span className="ed-count ed-narrow" aria-label={plural(n, "change")}>{n}</span>}</button>
    <Menu notionUrl={notionUrl} />
  </div>;
}

/** The outline and label over the text slot under the pointer or being edited. Positioned in page coordinates so it scrolls with the page. */
function Chip() {
  const hover = useEd((s) => s.hover), editing = useEd((s) => s.editing), target = editing ?? hover;
  useEd((s) => s.tick);
  if (!target?.el.isConnected) return null;
  const rect = target.el.getBoundingClientRect(), top = rect.top + window.scrollY, left = rect.left + window.scrollX, below = top < 40, width = document.documentElement.clientWidth;
  const near = !!editing && editing.length > editing.max * 0.8;
  return <>
    <div className="ed-outline" data-editing={!!editing || undefined} style={{ top: top - 4, left: left - 6, width: rect.width + 12, height: rect.height + 8 }} />
    <div className="ed-chip" data-editing={!!editing || undefined} data-below={below || undefined} style={{ top: below ? top + rect.height + 8 : top - 8, left: Math.max(8, Math.min(left - 6, window.scrollX + width - 260)) }}>
      <span className="ed-chip-name">{target.label}</span>
      {editing ? <>{editing.error ? <span className="ed-chip-error" role="alert">{editing.error}</span> : near ? <span className="ed-chip-note">{editing.length}/{editing.max}</span> : <span className="ed-chip-note ed-wide">{editing.multiline ? `${MOD}Enter saves` : "Enter saves"}, Esc cancels</span>}</>
        : <>{target.link && <button type="button" onClick={() => { const url = new URL(target.link ?? "/", window.location.href); patch({ hover: null }); go(url.origin === window.location.origin ? url.pathname + url.search + url.hash : url.href); }}>Open link</button>}
          <button type="button" aria-label={`Ask Claude about ${target.label}`} title="Ask Claude about this" onClick={() => ask(target.slot, target.el.textContent ?? "")}>{Icon.ask}</button></>}
    </div>
  </>;
}

function Notice() {
  const notice = useEd((s) => s.notice);
  useEffect(() => { if (!notice || notice.tone === "error") return; const timer = setTimeout(() => { if (getState().notice?.key === notice.key) patch({ notice: null }); }, notice.action ? 8000 : 3200); return () => clearTimeout(timer); }, [notice]);
  return <div className="ed-notice-wrap" role="status" aria-live="polite">{notice && <div key={notice.key} className="ed-notice" data-tone={notice.tone}><span>{notice.text}</span>{notice.action && <button type="button" className="ed-link" onClick={notice.action.run}>{notice.action.label}</button>}{(notice.tone === "error" || notice.action) && <button type="button" className="ed-icon" aria-label="Dismiss" onClick={() => patch({ notice: null })}>{Icon.close}</button>}</div>}</div>;
}

export const Failed = ({ onClose }: { onClose: () => void }) => <div className="ed ed-fail" role="status"><span>Editor failed to load</span><button type="button" className="ed-link" onClick={() => window.location.reload()}>Reload</button><button type="button" className="ed-icon" aria-label="Dismiss" onClick={onClose}>{Icon.close}</button></div>;
/** Whatever goes wrong inside the editor, the page stays usable: the chrome collapses to a small pill. */
export class Boundary extends Component<{ children?: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("Editor crashed.", error); }
  render() { return this.state.failed ? <Failed onClose={this.props.onClose} /> : this.props.children; }
}

export function App({ onClose }: { onClose: () => void }) {
  const phase = useEd((s) => s.phase), collapsed = useEd((s) => s.collapsed), view = useEd((s) => s.view), n = useEd(count);
  // The page makes room for the chrome (editor.css reads this attribute); the panel docks beside the page instead of covering it.
  useEffect(() => { if (phase === "ready") document.documentElement.setAttribute("data-ed", collapsed ? "pill" : view ? "panel" : "bar"); else document.documentElement.removeAttribute("data-ed"); }, [phase, collapsed, view]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && getState().view && !event.defaultPrevented) setView(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (phase === "failed") return <Failed onClose={onClose} />;
  if (phase !== "ready") return null;
  if (collapsed) return <div className="ed"><button type="button" className="ed-pill" onClick={() => setCollapsed(false)} aria-label={n ? `Edit site, ${plural(n, "unpublished change")}` : "Edit site"}>{Icon.mark}<span>Edit</span>{n > 0 && <span className="ed-count">{n}</span>}</button><Notice /></div>;
  return <div className="ed"><Chip /><Panel /><Notice /><Bar /></div>;
}
