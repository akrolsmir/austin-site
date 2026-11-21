import { cssValue, cssVar, validateValue, type ImageValue, type ListItem, type SlotDef } from "../site/schema";
import { arrange, cleanText, listSet } from "./draft";
import { getState, notify, patch, setValue, subscribe, type State, type Target } from "./store";

// The editor's hands on the page: it makes the server-rendered markup show the current values (published + draft) through the
// markup contract in docs/editable-site.md, and runs in-place text editing. React owns the page's nodes, so the rules are:
// never detach a node React rendered (hide it, or move it within its parent), write text with textContent (what React itself
// does for a single text child), and make every pass idempotent so the MutationObserver that re-runs it settles at once.
export const ROOT_ID = "site-editor";
const inEditor = (node: Node | null) => !!(node instanceof Element ? node : node?.parentElement)?.closest(`#${ROOT_ID}`);
const each = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => [...root.querySelectorAll<T>(selector)];
const attr = (el: Element, name: string, value: string | null) => { if (el.getAttribute(name) !== value) { if (value === null) el.removeAttribute(name); else el.setAttribute(name, value); } };
const setText = (el: Element, text: string) => { if (el !== editingEl && el.textContent !== text) el.textContent = text; };
const setHidden = (el: HTMLElement, hidden: boolean) => { if (el.hidden !== hidden) el.hidden = hidden; };
/** Puts `sequence` first among `box`'s children, in order, touching only nodes that are out of place. */
function arrangeChildren(box: Element, sequence: Element[]) {
  let previous: Element | null = null;
  for (const el of sequence) {
    const want: Element | null = previous ? previous.nextElementSibling : box.firstElementChild;
    if (want !== el) box.insertBefore(el, want);
    previous = el;
  }
}

// List items the editor adds are clones of a server-rendered item; the first one seen is remembered so an emptied list can grow back.
const templates = new Map<string, HTMLElement>();
function swapTag(el: Element, tag: string, drop: string[]) {
  const next = document.createElement(tag);
  for (const { name, value } of [...el.attributes]) if (!drop.includes(name)) next.setAttribute(name, value);
  next.textContent = el.textContent;
  el.replaceWith(next);
  return next;
}
function applyList(box: HTMLElement, id: string, def: Extract<SlotDef, { kind: "list" }>, items: ListItem[]) {
  const kids = ([...box.children] as HTMLElement[]).filter((kid) => kid.hasAttribute("data-e-item")), owned = kids.filter((kid) => !kid.hasAttribute("data-ed-clone")), clones = kids.filter((kid) => kid.hasAttribute("data-ed-clone"));
  if (!templates.has(id) && kids[0]) {
    const template = kids[0].cloneNode(true) as HTMLElement;
    for (const el of [template, ...each("*", template)]) for (const name of ["hidden", "data-ed-gone", "data-ed-clone", "contenteditable", "style", "id"]) if (el === template || name === "contenteditable") el.removeAttribute(name);
    templates.set(id, template);
  }
  const template = templates.get(id), urls = Object.keys(def.fields).filter((name) => def.fields[name].kind === "url"), used = new Set<HTMLElement>(), sequence: HTMLElement[] = [];
  if (!template) return;
  // A server-rendered item is reused only when its link/no-link shape already matches; otherwise a clone stands in for it.
  const fits = (el: HTMLElement, item: ListItem) => urls.every((name) => !!el.querySelector(`[data-e-field-href="${name}"]`) === !!item[name]);
  for (const item of items) {
    let el = owned.find((kid) => kid.dataset.eItem === item.id && !used.has(kid) && fits(kid, item)) ?? clones.find((kid) => kid.dataset.eItem === item.id && !used.has(kid));
    if (!el) { el = template.cloneNode(true) as HTMLElement; el.setAttribute("data-ed-clone", ""); el.setAttribute("data-e-item", item.id); }
    for (const name of urls) {
      const link = el.querySelector(`[data-e-field-href="${name}"]`), href = item[name];
      if (href && link) attr(link, "href", href);
      else if (href) { const host = el.querySelector("span[data-e-field]") ?? el.querySelector("[data-e-field]"); if (host) { const made = swapTag(host, "a", []); made.setAttribute("data-e-field-href", name); made.setAttribute("href", href); } }
      else if (link) swapTag(link, "span", ["href", "data-e-field-href", "target", "rel"]);
    }
    for (const name of Object.keys(def.fields)) if (def.fields[name].kind === "text") for (const field of each(`[data-e-field="${name}"]`, el)) setText(field, item[name]);
    used.add(el); sequence.push(el);
  }
  for (const kid of kids) {
    if (used.has(kid)) { if (kid.hasAttribute("data-ed-gone")) { kid.removeAttribute("data-ed-gone"); kid.hidden = false; } }
    else if (kid.hasAttribute("data-ed-clone")) kid.remove();
    else if (!kid.hasAttribute("data-ed-gone")) { kid.setAttribute("data-ed-gone", ""); kid.hidden = true; }
  }
  arrangeChildren(box, sequence);
}

/** Makes the page show `s.values`. Safe to call at any time and any number of times. */
export function applyDom(s: State = getState()) {
  const { slots, values } = s, root = document.documentElement;
  for (const [id, def] of Object.entries(slots)) {
    if (!id.startsWith("theme.")) continue;
    // Every token is set inline, not only drafted ones: a cached page may lag behind what was just published.
    const css = cssValue(def, values[id]);
    if (css === undefined) { if (root.style.getPropertyValue(cssVar(id))) root.style.removeProperty(cssVar(id)); }
    else if (root.style.getPropertyValue(cssVar(id)) !== css) root.style.setProperty(cssVar(id), css);
  }
  for (const el of each("[data-e]")) { const id = el.dataset.e ?? "", value = values[id]; if (slots[id]?.kind === "text" && typeof value === "string" && !inEditor(el)) setText(el, value); }
  for (const el of each("[data-e-href]")) { const id = el.dataset.eHref ?? "", value = values[id]; if (slots[id]?.kind === "url" && typeof value === "string" && validateValue(slots[id], value).ok) attr(el, "href", value); }
  for (const el of each<HTMLImageElement>("img[data-e-img]")) {
    const id = el.dataset.eImg ?? "", checked = slots[id]?.kind === "image" ? validateValue(slots[id], values[id]) : undefined;
    if (!checked?.ok) continue;
    const image = checked.value as ImageValue;
    // next/image carries a srcset of the old file; while a different one is previewed it is dropped.
    if (el.getAttribute("src") !== image.url && !(el.getAttribute("srcset") ?? "").includes(encodeURIComponent(image.url))) { el.removeAttribute("srcset"); el.removeAttribute("sizes"); el.src = image.url; el.width = image.width; el.height = image.height; }
    attr(el, "alt", image.alt);
  }
  for (const [id, def] of Object.entries(slots)) {
    if (def.kind === "order" && Array.isArray(values[id])) {
      const { ids, hidden } = arrange(def.items, values[id] as string[]);
      for (const box of each(`[data-e-order="${id}"]`)) {
        const sections = new Map(([...box.children] as HTMLElement[]).filter((kid) => kid.dataset.section).map((kid) => [kid.dataset.section, kid]));
        arrangeChildren(box, ids.flatMap((item) => sections.get(item) ?? []));
        for (const [item, el] of sections) setHidden(el, !ids.includes(item ?? "") || hidden.includes(item ?? ""));
      }
      // Only links that point at a homepage section follow its visibility (the writing link goes to /posts and always shows).
      for (const item of def.items) for (const link of each(`[data-nav-for="${item}"]`)) if ((link.getAttribute("href") ?? "").includes("#")) setHidden(link, hidden.includes(item));
    }
    if (def.kind === "list" && Array.isArray(values[id])) for (const box of each(`[data-e-list="${id}"]`)) applyList(box, id, def, values[id] as ListItem[]);
  }
}
/** Whether the page can show a list right now (an empty server-rendered list has no item to clone until one has been seen). */
export const canPreviewList = (id: string) => templates.has(id) || !document.querySelector(`[data-e-list="${id}"]`) || !!document.querySelector(`[data-e-list="${id}"] > [data-e-item]`);

// In-place editing.
let editingEl: HTMLElement | null = null, stopEditing: ((commit: boolean) => void) | null = null;
const read = (el: Node): string => [...el.childNodes].map((node) => node.nodeType === 3 ? node.nodeValue ?? "" : node.nodeName === "BR" ? "\n" : read(node)).join("");
/** The editable slot (or list field) at a node, if any. */
export function targetOf(node: EventTarget | null, s: State = getState()): Target | null {
  const el = node instanceof Element ? node.closest<HTMLElement>("[data-e],[data-e-field]") : null;
  if (!el || inEditor(el)) return null;
  const link = el.closest<HTMLAnchorElement>("a[href]")?.href ?? null;
  if (el.dataset.e) { const slot = el.dataset.e, def = s.slots[slot]; return def?.kind === "text" ? { el, slot, label: def.label, max: def.max, multiline: !!def.multiline, link } : null; }
  const slot = el.closest<HTMLElement>("[data-e-list]")?.dataset.eList ?? "", item = el.closest<HTMLElement>("[data-e-item]")?.dataset.eItem, field = el.dataset.eField ?? "", def = s.slots[slot], spec = def?.kind === "list" ? def.fields[field] : undefined;
  if (!item || def?.kind !== "list" || spec?.kind !== "text" || !(s.values[slot] as ListItem[]).some((entry) => entry.id === item)) return null;
  return { el, slot, item, field, label: `${def.label}: ${spec.label.toLowerCase()}`, max: spec.max ?? 200, multiline: false, link };
}
/** The value a target would store for `text`, validated the way Publish will be. */
function resolve(target: Target, text: string, s: State = getState()) {
  const def = s.slots[target.slot];
  return validateValue(def, target.item && target.field ? listSet(s.values[target.slot] as ListItem[], target.item, target.field, text) : text);
}
export function startEdit(target: Target, point?: { x: number; y: number }) {
  stopEditing?.(true);
  const { el } = target, before = el.textContent ?? "", outline = el.style.outline;
  el.setAttribute("contenteditable", "plaintext-only");
  if (el.contentEditable !== "plaintext-only") el.setAttribute("contenteditable", "true");
  el.setAttribute("spellcheck", "true"); el.style.outline = "none";
  const report = () => { const text = cleanText(read(el), target.multiline), checked = resolve(target, text); patch({ editing: { ...target, length: text.length, error: checked.ok ? "" : text.length > target.max ? `${text.length - target.max} over the limit of ${target.max}` : checked.error }, tick: getState().tick + 1 }); };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
    else if (event.key === "Enter" && !event.isComposing && (!target.multiline || event.metaKey || event.ctrlKey)) { event.preventDefault(); const text = cleanText(read(el), target.multiline); if (resolve(target, text).ok) finish(true); else report(); }
  };
  // Only the richtext fallback needs this: plaintext-only already pastes plain text.
  const onPaste = (event: ClipboardEvent) => { if (el.contentEditable === "plaintext-only") return; event.preventDefault(); document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") ?? ""); };
  const onBlur = () => finish(true);
  function finish(commit: boolean) {
    if (editingEl !== el) return;
    el.removeEventListener("keydown", onKey); el.removeEventListener("input", report); el.removeEventListener("blur", onBlur); el.removeEventListener("paste", onPaste);
    el.removeAttribute("contenteditable"); el.removeAttribute("spellcheck"); el.style.outline = outline;
    if (!el.getAttribute("style")) el.removeAttribute("style");
    const text = cleanText(read(el), target.multiline), checked = commit ? resolve(target, text) : undefined;
    editingEl = null; stopEditing = null;
    // Back to one clean text node, then the store decides what the page shows.
    el.textContent = before;
    if (el === document.activeElement) el.blur();
    patch({ editing: null, hover: null });
    if (checked?.ok && text !== before) setValue(target.slot, checked.value, true);
    else if (checked && !checked.ok) notify(`${target.label} was not changed: it ${text.length > target.max ? `can be at most ${target.max} characters` : checked.error}.`, "error");
    applyDom();
  }
  editingEl = el; stopEditing = finish;
  el.addEventListener("keydown", onKey); el.addEventListener("input", report); el.addEventListener("blur", onBlur); el.addEventListener("paste", onPaste);
  el.focus({ preventScroll: true });
  const selection = window.getSelection(), doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
  let range: Range | null = null;
  if (point) {
    const position = doc.caretPositionFromPoint?.(point.x, point.y);
    if (position && el.contains(position.offsetNode)) { range = document.createRange(); range.setStart(position.offsetNode, position.offset); }
    else { const found = doc.caretRangeFromPoint?.(point.x, point.y) ?? null; if (found && el.contains(found.startContainer)) range = found; }
  }
  if (!range) { range = document.createRange(); range.selectNodeContents(el); if (point) range.collapse(false); }
  else range.collapse(true);
  selection?.removeAllRanges(); selection?.addRange(range);
  patch({ hover: null }); report();
}

/** Wires the page: re-applies values whenever React or a navigation changes the DOM, and turns clicks on slots into edits. Returns the teardown. */
export function attach(): () => void {
  let frame = 0, leave: ReturnType<typeof setTimeout> | undefined;
  // The post page names its Notion page in data-notion-url; the meta link is the fallback for markup that predates it.
  const notion = () => { const href = document.querySelector<HTMLElement>("main [data-notion-url]")?.dataset.notionUrl || (/^\/posts\/[^/]+\/?$/.test(location.pathname) ? document.querySelector<HTMLAnchorElement>("main .article-meta a[href]")?.href : undefined); return href && /^https?:\/\//.test(href) ? href : null; };
  const pass = () => { frame = 0; try { applyDom(); patch({ path: location.pathname, notionUrl: notion(), tick: getState().tick + 1 }); if (getState().hover && !getState().hover?.el.isConnected) patch({ hover: null }); } catch (error) { console.error("Editor could not update the page.", error); patch({ phase: "failed" }); } };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(pass); };
  const observer = new MutationObserver((records) => { if (records.some((record) => !inEditor(record.target) && !(editingEl && editingEl.contains(record.target)))) schedule(); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "href", "data-e", "data-e-item"] });
  const active = () => { const s = getState(); return s.phase === "ready" && !s.collapsed; };
  const onClick = (event: MouseEvent) => {
    if (!active() || event.button !== 0 || inEditor(event.target as Node)) return;
    if (editingEl && editingEl.contains(event.target as Node)) { event.preventDefault(); event.stopPropagation(); return; }
    const target = targetOf(event.target);
    if (!target || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!target.link && !window.getSelection()?.isCollapsed) return;
    event.preventDefault(); event.stopPropagation();
    startEdit(target, { x: event.clientX, y: event.clientY });
  };
  const onOver = (event: PointerEvent) => {
    if (!active() || editingEl || event.pointerType === "touch") return;
    const node = event.target as Element | null;
    if (node?.closest?.(".ed-chip")) return clearTimeout(leave);
    const target = targetOf(node);
    clearTimeout(leave);
    if (target) { if (getState().hover?.el !== target.el) patch({ hover: target }); }
    else if (getState().hover) leave = setTimeout(() => patch({ hover: null }), 220);
  };
  // A link being edited must not drag, and its text must not be followed.
  const onDrag = (event: DragEvent) => { if (editingEl && editingEl.contains(event.target as Node)) event.preventDefault(); };
  const onResize = () => patch({ tick: getState().tick + 1 });
  // A change to the draft or the published overlay shows on the page at once.
  let seen = getState().values;
  const unsubscribe = subscribe(() => { const s = getState(); if (s.phase !== "ready" || s.values === seen) return; seen = s.values; try { applyDom(s); } catch { /* the next pass reports it */ } schedule(); });
  window.addEventListener("click", onClick, true); document.addEventListener("pointerover", onOver, true); document.addEventListener("dragstart", onDrag, true);
  window.addEventListener("resize", onResize); window.addEventListener("popstate", schedule);
  pass();
  return () => {
    stopEditing?.(false); unsubscribe(); observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(leave);
    window.removeEventListener("click", onClick, true); document.removeEventListener("pointerover", onOver, true); document.removeEventListener("dragstart", onDrag, true);
    window.removeEventListener("resize", onResize); window.removeEventListener("popstate", schedule);
  };
}
/** Undoes everything the editor put on the page (used when the owner's session ends). */
export function clearDom() {
  for (const id of Object.keys(getState().slots)) if (id.startsWith("theme.")) document.documentElement.style.removeProperty(cssVar(id));
  for (const el of each("[data-ed-clone]")) el.remove();
  for (const el of each("[data-ed-gone]")) { el.removeAttribute("data-ed-gone"); el.hidden = false; }
  document.documentElement.removeAttribute("data-ed");
}
