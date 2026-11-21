import { defaults as codeDefaults, slots as codeSlots, validateValue, type SlotDef } from "../site/schema";
import { baseValues, layer, parseDraft, pruneDraft, publishOverlay, setDraft, summarise, type Check, type Def, type Draft, type Values } from "./draft";

// The editor's state and every call it makes to the server. One plain store (subscribe + snapshot) that the React chrome and the
// DOM layer both read; nothing here touches the page's markup.
export type Version = { hash: string; at: string; summary: string; by: string };
export type Notice = { text: string; tone: "info" | "error"; key: number; action?: { label: string; run: () => void } };
/** A text slot (or one text field of a list item) that can be edited in place. */
export type Target = { el: HTMLElement; slot: string; item?: string; field?: string; label: string; max: number; multiline: boolean; link: string | null };
export type State = {
  phase: "loading" | "ready" | "failed" | "gone";
  slots: Record<string, SlotDef>; defaults: Values; overlay: Values; base: Values; draft: Draft; values: Values;
  history: Version[]; current: string | null;
  /** Bumped when values change from outside the panel's own inputs, so its controls remount with fresh local state. */
  epoch: number;
  errors: Record<string, string>; busy: "" | "publish" | "revert" | "signout"; notice: Notice | null;
  view: null | "customize" | "history"; filter: "all" | "changed"; collapsed: boolean;
  path: string; notionUrl: string | null; hover: Target | null; editing: (Target & { length: number; error: string }) | null; tick: number;
};

const DRAFT_KEY = "site-draft", UI_KEY = "site-editor";
const check = validateValue as unknown as Check, asDefs = (slots: Record<string, SlotDef>) => slots as unknown as Record<string, Def>;
const storage = { get: (key: string) => { try { return localStorage.getItem(key); } catch { return null; } }, set: (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode: the draft lives for this page only */ } } };
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

let state: State = { phase: "loading", slots: codeSlots, defaults: codeDefaults, overlay: {}, base: codeDefaults, draft: {}, values: codeDefaults, history: [], current: null, epoch: 0, errors: {}, busy: "", notice: null, view: null, filter: "all", collapsed: false, path: "/", notionUrl: null, hover: null, editing: null, tick: 0 };
const listeners = new Set<() => void>();
export const getState = () => state;
export const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function patch(next: Partial<State>) {
  if (Object.entries(next).every(([key, value]) => state[key as keyof State] === value)) return;
  state = { ...state, ...next };
  for (const listener of [...listeners]) listener();
}
let noticeKey = 0;
export const notify = (text: string, tone: Notice["tone"] = "info", action?: Notice["action"]) => patch({ notice: { text, tone, key: ++noticeKey, action } });
export const count = (s: State = state) => Object.keys(s.draft).length;
export const isDefault = (id: string, s: State = state) => JSON.stringify(s.values[id]) === JSON.stringify(s.defaults[id]);

function saveUi() { storage.set(UI_KEY, JSON.stringify({ collapsed: state.collapsed })); }
function withDraft(draft: Draft, extra: Partial<State> = {}, persist = true) {
  const base = extra.base ?? state.base, defaults = extra.defaults ?? state.defaults;
  if (persist) storage.set(DRAFT_KEY, JSON.stringify(draft));
  const errors = Object.fromEntries(Object.entries(extra.errors ?? state.errors).filter(([id]) => Object.hasOwn(draft, id)));
  patch({ ...extra, draft, errors, values: layer(base, defaults, draft) });
}
/** Sets one slot in the draft (null resets it to the code default). `external` is any source other than the panel control for that slot. */
export function setValue(id: string, value: unknown, external = false) {
  const errors = { ...state.errors };
  delete errors[id];
  withDraft(setDraft(state.draft, id, value, state.base, state.defaults), { errors, ...(external ? { epoch: state.epoch + 1 } : {}) });
}
export function discard() {
  const before = state.draft;
  withDraft({}, { epoch: state.epoch + 1, errors: {} });
  notify("Draft discarded", "info", { label: "Undo", run: () => { withDraft(pruneDraft({ ...before, ...state.draft }, asDefs(state.slots), state.base, state.defaults, check), { epoch: state.epoch + 1 }); patch({ notice: null }); } });
}
export const setCollapsed = (collapsed: boolean) => { patch({ collapsed, view: collapsed ? null : state.view, hover: null }); saveUi(); };
/** Another tab changed the draft: follow it. */
export function syncDraftFromStorage() { if (state.phase === "ready") withDraft(pruneDraft(parseDraft(storage.get(DRAFT_KEY)), asDefs(state.slots), state.base, state.defaults, check), { epoch: state.epoch + 1 }, false); }

type Reply = { status: number; data: Record<string, unknown> };
async function call(path: string, init?: RequestInit): Promise<Reply> {
  try {
    const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...init }), data: unknown = await response.json().catch(() => null);
    return { status: response.status, data: plain(data) ? data : {} };
  } catch { return { status: 0, data: {} }; }
}
const post = (path: string, body: unknown) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
/** The session is not the owner's (any more): drop the hint cookie so the bundle stops loading, and take the editor off the page. */
function gone() { document.cookie = "editor=; Path=/; Max-Age=0; SameSite=Lax"; patch({ phase: "gone", view: null, hover: null }); }
const UNAVAILABLE = "Publishing isn't set up on this deployment.";
// Next keeps a public router on window; a refresh re-renders the server components with what was just published.
function refreshPage() { try { (window as unknown as { next?: { router?: { refresh?: () => void } } }).next?.router?.refresh?.(); } catch { /* the DOM layer keeps the page right regardless */ } }

/** Loads the published overlay and history. Returns false when the editor cannot (or may not) run. */
export async function load(first = false): Promise<boolean> {
  const { status, data } = await call("/api/overlay");
  if (status === 401) { gone(); return false; }
  if (status !== 200 || !plain(data.overlay)) { if (first) patch({ phase: "failed" }); return false; }
  const slots = plain(data.slots) && Object.keys(data.slots).length ? data.slots as Record<string, SlotDef> : codeSlots, defaults = plain(data.defaults) ? data.defaults : codeDefaults;
  const base = baseValues(asDefs(slots), defaults, data.overlay, check), history = (Array.isArray(data.history) ? data.history : []).filter((v): v is Version => plain(v) && typeof v.hash === "string" && typeof v.at === "string").map((v) => ({ hash: v.hash, at: v.at, summary: String(v.summary ?? ""), by: String(v.by ?? "") }));
  const draft = pruneDraft(first ? parseDraft(storage.get(DRAFT_KEY)) : state.draft, asDefs(slots), base, defaults, check);
  let ui: unknown = null;
  try { ui = JSON.parse(storage.get(UI_KEY) ?? "null"); } catch { /* defaults */ }
  withDraft(draft, { phase: "ready", slots, defaults, overlay: data.overlay, base, history, current: typeof data.current === "string" ? data.current : null, epoch: state.epoch + 1, ...(first ? { collapsed: plain(ui) && ui.collapsed === true } : {}) });
  return true;
}
export async function publish() {
  if (state.busy || !count()) return;
  const draft = state.draft, defs = asDefs(state.slots);
  patch({ busy: "publish" });
  const { status, data } = await post("/api/overlay", { patch: draft, summary: summarise(draft, defs) });
  if (status === 200) {
    // Edits made while the request was in flight stay in the draft.
    const overlay = publishOverlay(state.overlay, draft), base = baseValues(defs, state.defaults, overlay, check);
    withDraft(pruneDraft(state.draft, defs, base, state.defaults, check), { overlay, base, busy: "", errors: {}, epoch: state.epoch + 1 });
    notify("Published");
    await load();
    refreshPage();
  } else if (status === 401) gone();
  else if (status === 409) {
    const reloaded = await load();
    patch({ busy: "" });
    notify(reloaded ? "The site changed somewhere else, so nothing was published. Your draft now sits on the newer version: check it and publish again." : "The site changed somewhere else, so nothing was published. Reload the page and try again.", "error");
  } else if (status === 400 && plain(data.slots)) {
    const errors = Object.fromEntries(Object.entries(data.slots).map(([id, message]) => [id, String(message)])), names = Object.keys(errors).map((id) => state.slots[id]?.label ?? id);
    patch({ busy: "", errors, view: "customize", filter: "changed" });
    notify(`Not published. ${names.length === 1 ? `${names[0]} was` : `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""} were`} not accepted.`, "error");
  } else { patch({ busy: "" }); notify(status === 503 ? UNAVAILABLE : status === 0 ? "Not published: the server could not be reached." : "Not published. Try again.", "error"); }
}
/** Points the site at an earlier version; null is the code defaults. The draft is kept on top. */
export async function revert(hash: string | null) {
  if (state.busy) return;
  patch({ busy: "revert" });
  const { status } = await post("/api/overlay/revert", { hash });
  if (status === 401) return gone();
  if (status === 200) { await load(); patch({ busy: "" }); notify(hash === null ? "The site is back to its defaults" : "Reverted"); refreshPage(); return; }
  patch({ busy: "" });
  notify(status === 503 ? UNAVAILABLE : status === 404 ? "That version is no longer available." : status === 409 ? "The site changed somewhere else. Try again." : status === 0 ? "Not reverted: the server could not be reached." : "Not reverted. Try again.", "error");
  if (status === 404 || status === 409) await load();
}
export async function signOut() {
  if (state.busy) return;
  patch({ busy: "signout" });
  const { status } = await post("/api/auth/sign-out", {});
  if (status !== 200) { patch({ busy: "" }); return notify("Couldn't sign out. Try again.", "error"); }
  await call("/api/me");
  // The draft stays in this browser for the next sign-in; the reload shows the site as visitors see it.
  if (!/(?:^|;\s*)editor=1(?:;|$)/.test(document.cookie)) gone();
  window.location.reload();
}
/** Sends a (downsized) JPEG to the image route. */
export async function uploadImage(file: Blob, alt: string): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const form = new FormData();
  form.set("file", file, "image.jpg"); form.set("alt", alt);
  const { status, data } = await call("/api/overlay/image", { method: "POST", body: form });
  if (status === 401) { gone(); return { ok: false, error: "Sign in again." }; }
  if (status !== 200) return { ok: false, error: status === 503 ? "Image uploads aren't set up on this deployment." : typeof data.error === "string" && status < 500 ? data.error : "The image could not be uploaded. Try again." };
  return validateValue({ kind: "image", label: "", group: "" }, data);
}
