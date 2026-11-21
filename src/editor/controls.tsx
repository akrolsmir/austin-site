import { useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { fonts, validateValue, type ImageValue, type ListItem, type SlotDef } from "../site/schema";
import { canPreviewList } from "./dom";
import { arrange, blankItem, fitWithin, hex6, listAdd, listRemove, listSet, move, toggleOrder } from "./draft";
import { getState, isDefault, setValue, subscribe, uploadImage, type State } from "./store";

// The side panel's controls: one per slot kind. Each keeps what was typed in local state (so a half-typed colour or link can sit
// there with its error) and sends only validated values to the draft; the panel remounts a control when its value changes elsewhere.
export const useEd = <T,>(select: (s: State) => T): T => useSyncExternalStore(subscribe, () => select(getState()), () => select(getState()));
type Props<K extends SlotDef["kind"] = SlotDef["kind"]> = { id: string; def: SlotDef & { kind: K }; labelled: string };
const dom = (id: string) => `ed-${id.replace(/[^a-z0-9]+/gi, "-")}`;
const svg = (path: ReactNode, size = 16) => <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
export const Icon = {
  mark: <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" /></svg>,
  sliders: svg(<><path d="M2 4.5h6.5M12 4.5h2M2 11.5h2M7.5 11.5H14" /><circle cx="10.25" cy="4.5" r="1.75" /><circle cx="5.75" cy="11.5" r="1.75" /></>),
  clock: svg(<><circle cx="8" cy="8" r="6" /><path d="M8 4.75V8l2.25 1.5" /></>),
  ask: svg(<><path d="M2.5 3.5h11v7.5H8l-3 2.5V11H2.5z" /><path d="M5.75 6.25h4.5M5.75 8.25h3" /></>),
  more: svg(<><circle cx="3.5" cy="8" r=".6" fill="currentColor" /><circle cx="8" cy="8" r=".6" fill="currentColor" /><circle cx="12.5" cy="8" r=".6" fill="currentColor" /></>),
  close: svg(<path d="M4 4l8 8M12 4l-8 8" />),
  reset: svg(<><path d="M3 8a5 5 0 1 0 1.6-3.7" /><path d="M2.75 2.5v2.75H5.5" /></>, 14),
  up: svg(<path d="M4 9.5l4-4 4 4" />, 14), down: svg(<path d="M4 6.5l4 4 4-4" />, 14),
  chevron: svg(<path d="M6 4l4 4-4 4" />, 14),
  eye: svg(<><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="1.9" /></>),
  eyeOff: svg(<><path d="M6.4 3.7A6 6 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.9 2.4M10.8 11.8A6 6 0 0 1 8 12.5C4 12.5 1.5 8 1.5 8a11 11 0 0 1 2.7-3" /><path d="M2.5 2.5l11 11" /></>),
  grip: <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">{[3.5, 8, 12.5].flatMap((y) => [5.5, 10.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />))}</svg>,
  trash: svg(<path d="M2.75 4.5h10.5M6.25 4.5V2.75h3.5V4.5M4.25 4.5l.6 8.75h6.3l.6-8.75M6.75 7v3.5M9.25 7v3.5" />, 14),
  plus: svg(<path d="M8 3.5v9M3.5 8h9" />, 14),
  out: svg(<path d="M6.5 3.5h6v6M12.5 3.5L4 12" />, 12),
};

/** Local text for an input plus the validated value it stands for. */
function useRaw<T>(id: string, def: SlotDef, initial: (value: unknown) => T, toValue: (raw: T) => unknown) {
  const [raw, setRaw] = useState<T>(() => initial(getState().values[id])), [error, setError] = useState("");
  const change = (next: T) => { setRaw(next); const checked = validateValue(def, toValue(next)); if (checked.ok) { setError(""); setValue(id, checked.value); } else setError(checked.error); };
  return [raw, change, error] as const;
}
const Problem = ({ id, error, lead = "Not applied yet: it" }: { id: string; error: string; lead?: string }) => error ? <p className="ed-error" id={`${dom(id)}-error`} role="alert">{lead} {error}.</p> : null;

function TextControl({ id, def }: Props<"text">) {
  const [raw, change, error] = useRaw<string>(id, def, (value) => String(value ?? ""), (text) => text), near = raw.length > def.max * 0.8;
  const shared = { id: dom(id), className: "ed-input", value: raw, "aria-invalid": !!error || undefined, "aria-describedby": error ? `${dom(id)}-error` : undefined, spellCheck: true };
  return <>{def.multiline ? <textarea {...shared} rows={4} onChange={(event) => change(event.target.value)} /> : <input {...shared} type="text" autoComplete="off" onChange={(event) => change(event.target.value)} />}
    {near && !error && <p className="ed-hint">{raw.length} of {def.max} characters</p>}<Problem id={id} error={error} /></>;
}
function UrlControl({ id, def }: Props<"url">) {
  const [raw, change, error] = useRaw<string>(id, def, (value) => String(value ?? ""), (text) => text.trim());
  return <><input id={dom(id)} className="ed-input" type="url" inputMode="url" autoComplete="off" spellCheck={false} value={raw} aria-invalid={!!error || undefined} onChange={(event) => change(event.target.value)} /><Problem id={id} error={error} /></>;
}
function ColorControl({ id, def }: Props<"color">) {
  const [raw, change, error] = useRaw<string>(id, def, (value) => String(value ?? ""), (text) => (text.trim().startsWith("#") ? text.trim() : `#${text.trim()}`));
  const applied = useEd((s) => String(s.values[id] ?? "#000000"));
  return <><div className="ed-color"><input type="color" aria-label={`${def.label} colour picker`} value={hex6(applied)} onChange={(event) => change(event.target.value)} /><input id={dom(id)} className="ed-input ed-hex" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={7} value={raw} aria-invalid={!!error || undefined} onChange={(event) => change(event.target.value)} /></div><Problem id={id} error={error} /></>;
}
function NumberControl({ id, def }: Props<"length" | "number">) {
  const step = def.kind === "number" ? def.step : 1, tidy = (value: number) => Number(value.toFixed(4));
  const [raw, change, error] = useRaw<string>(id, def, (value) => String(value ?? ""), (text) => (text.trim() === "" ? NaN : tidy(Number(text))));
  const applied = useEd((s) => Number(s.values[id]));
  return <><div className="ed-number"><input type="range" aria-label={`${def.label} slider`} min={def.min} max={def.max} step={step} value={Number.isFinite(applied) ? applied : def.min} onChange={(event) => change(String(tidy(Number(event.target.value))))} />
    <span className="ed-unit"><input id={dom(id)} className="ed-input" type="number" inputMode="decimal" min={def.min} max={def.max} step={step} value={raw} aria-invalid={!!error || undefined} onChange={(event) => change(event.target.value)} />{def.kind === "length" && def.unit && <span aria-hidden="true">{def.unit}</span>}</span></div><Problem id={id} error={error} /></>;
}
function FontControl({ id, labelled }: Props<"font">) {
  const value = useEd((s) => String(s.values[id]));
  return <div className="ed-fonts" role="radiogroup" aria-labelledby={labelled}>{Object.entries(fonts).map(([key, font]) => <label key={key} className="ed-font" style={{ fontFamily: font.stack }}><input type="radio" name={dom(id)} checked={value === key} onChange={() => setValue(id, key)} /><span>{font.label}</span></label>)}</div>;
}

/** Pointer drag on a row's handle: reports moves as the pointer crosses other rows' midpoints. Works with mouse, pen, and touch. */
function dragHandle<T>(index: number, limit: number, list: T[], commit: (next: T[]) => void, setDragging: (index: number | null) => void) {
  return (event: ReactPointerEvent<HTMLElement>) => {
    const box = event.currentTarget.closest("[data-ed-rows]");
    if (event.button !== 0 || !box) return;
    event.preventDefault();
    let from = index, working = list;
    setDragging(from);
    const onMove = (moved: PointerEvent) => {
      const rows = [...box.children].slice(0, limit), to = rows.filter((row, i) => { const rect = row.getBoundingClientRect(); return i !== from && rect.top + rect.height / 2 < moved.clientY; }).length;
      if (to === from || to >= limit) return;
      working = move(working, from, to); from = to;
      commit(working); setDragging(to);
    };
    const onEnd = () => { setDragging(null); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onEnd); window.removeEventListener("pointercancel", onEnd); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onEnd); window.addEventListener("pointercancel", onEnd);
  };
}
const title = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function OrderControl({ id, def, labelled }: Props<"order">) {
  const [order, setOrder] = useState<string[]>(() => [...(getState().values[id] as string[])]), [dragging, setDragging] = useState<number | null>(null);
  const { ids, hidden } = arrange(def.items, order), shown = ids.length - hidden.length, commit = (next: string[]) => { setOrder(next); setValue(id, next); };
  return <ul className="ed-rows" data-ed-rows aria-labelledby={labelled}>{ids.map((item, index) => { const off = hidden.includes(item), name = title(item); return <li key={item} className="ed-row" data-off={off || undefined} data-dragging={dragging === index || undefined}>
    <span className="ed-grip" aria-hidden="true" onPointerDown={off ? undefined : dragHandle(index, shown, order, commit, setDragging)}>{Icon.grip}</span>
    <span className="ed-row-name">{name}{off && <em>Hidden</em>}</span>
    <button type="button" className="ed-icon" aria-label={`Move ${name} up`} aria-disabled={off || index === 0} onClick={() => { if (!(off || index === 0)) commit(move(order, index, index - 1)); }}>{Icon.up}</button>
    <button type="button" className="ed-icon" aria-label={`Move ${name} down`} aria-disabled={off || index >= shown - 1} onClick={() => { if (!(off || index >= shown - 1)) commit(move(order, index, index + 1)); }}>{Icon.down}</button>
    <button type="button" className="ed-icon" aria-label={off ? `Show ${name}` : `Hide ${name}`} aria-pressed={!off} onClick={() => commit(toggleOrder(order, item))}>{off ? Icon.eyeOff : Icon.eye}</button>
  </li>; })}</ul>;
}

function ListControl({ id, def, labelled }: Props<"list">) {
  const [items, setItems] = useState<ListItem[]>(() => (getState().values[id] as ListItem[]).map((item) => ({ ...item }))), [error, setError] = useState(""), [open, setOpen] = useState<string | null>(null), [fresh, setFresh] = useState<string | null>(null), [dragging, setDragging] = useState<number | null>(null);
  const names = Object.keys(def.fields), lead = names.find((name) => def.fields[name].kind === "text") ?? names[0], noun = def.label.toLowerCase().replace(/s$/, "");
  const commit = (next: ListItem[]) => { setItems(next); const checked = validateValue(def, next); if (checked.ok) { setError(""); setValue(id, checked.value); } else setError(checked.error); };
  const add = () => { const item = blankItem(def.fields, items, `New ${noun}`) as ListItem; commit(listAdd(items, item) as ListItem[]); setOpen(item.id); setFresh(item.id); };
  return <div className="ed-list" aria-labelledby={labelled} role="group">
    {items.length === 0 && <p className="ed-empty">No {def.label.toLowerCase()} yet.</p>}
    <ul className="ed-rows" data-ed-rows>{items.map((item, index) => { const name = item[lead] || "Untitled", expanded = open === item.id; return <li key={item.id} className="ed-item" data-open={expanded || undefined} data-dragging={dragging === index || undefined}>
      <div className="ed-row">
        <span className="ed-grip" aria-hidden="true" onPointerDown={dragHandle(index, items.length, items, commit, setDragging)}>{Icon.grip}</span>
        <button type="button" className="ed-row-name ed-row-toggle" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : item.id)}><span>{name}</span></button>
        <button type="button" className="ed-icon" aria-label={`Move ${name} up`} aria-disabled={index === 0} onClick={() => { if (!(index === 0)) commit(move(items, index, index - 1)); }}>{Icon.up}</button>
        <button type="button" className="ed-icon" aria-label={`Move ${name} down`} aria-disabled={index === items.length - 1} onClick={() => { if (!(index === items.length - 1)) commit(move(items, index, index + 1)); }}>{Icon.down}</button>
        <button type="button" className="ed-icon" aria-label={`Remove ${name}`} onClick={() => commit(listRemove(items, item.id) as ListItem[])}>{Icon.trash}</button>
      </div>
      {expanded && <div className="ed-item-fields">{names.map((field, n) => { const spec = def.fields[field], fieldId = `${dom(id)}-${item.id}-${field}`; return <label key={field} htmlFor={fieldId}><span>{spec.label}{spec.optional && <em>optional</em>}</span>
        <input id={fieldId} className="ed-input" type={spec.kind === "url" ? "url" : "text"} inputMode={spec.kind === "url" ? "url" : undefined} autoComplete="off" spellCheck={spec.kind === "text"} placeholder={spec.kind === "url" ? "https://" : undefined} autoFocus={fresh === item.id && n === 0} onFocus={fresh === item.id && n === 0 ? (event) => event.target.select() : undefined} value={item[field]} onChange={(event) => commit(listSet(items, item.id, field, event.target.value) as ListItem[])} /></label>; })}</div>}
    </li>; })}</ul>
    <Problem id={id} error={error} lead="Not applied yet:" />
    {!error && items.length > 0 && !canPreviewList(id) && <p className="ed-hint">The page shows these once they are published.</p>}
    <button type="button" className="ed-add" disabled={items.length >= def.maxItems} onClick={add}>{Icon.plus}<span>Add {noun}</span></button>
  </div>;
}

/** Re-encodes any image the browser can read as a JPEG under ~4 MB (the host caps request bodies near 4.5 MB), upright and without metadata. */
async function downsize(file: File, limit = 4_000_000): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    for (const [edge, quality] of [[2400, 0.88], [2400, 0.78], [1800, 0.8], [1400, 0.78], [1000, 0.72]] as const) {
      const size = fitWithin(bitmap.width, bitmap.height, edge), canvas = document.createElement("canvas"), context = canvas.getContext("2d");
      canvas.width = size.width; canvas.height = size.height;
      if (!context) break;
      context.fillStyle = "#fff"; context.fillRect(0, 0, size.width, size.height); context.drawImage(bitmap, 0, 0, size.width, size.height);
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", quality));
      if (blob && blob.size <= limit) return blob;
    }
  } finally { bitmap.close(); }
  throw new Error("too large");
}
function ImageControl({ id, def }: Props<"image">) {
  const [image, setImage] = useState<ImageValue | null>(() => { const checked = validateValue(def, getState().values[id]); return checked.ok ? checked.value as ImageValue : null; }), [alt, setAlt] = useState(image?.alt ?? ""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const commit = (next: ImageValue) => { const checked = validateValue(def, next); if (checked.ok) { setError(""); setImage(checked.value as ImageValue); setValue(id, checked.value); } else setError(checked.error); };
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const sent = await uploadImage(await downsize(file), validateValue({ kind: "text", label: "", group: "", max: 300 }, alt).ok ? alt : "");
      if (sent.ok) commit(sent.value as ImageValue); else setError(sent.error.replace(/\.$/, ""));
    } catch { setError("That file could not be read as an image"); }
    setBusy(false);
  }
  return <div className="ed-image">
    {/* eslint-disable-next-line @next/next/no-img-element -- a preview of an arbitrary validated https image inside the owner-only editor */}
    {image ? <img src={image.url} alt="" width={image.width} height={image.height} /> : <span className="ed-image-none">No image</span>}
    <div><label className="ed-add ed-file" data-busy={busy || undefined}><input type="file" accept="image/*" disabled={busy} onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ""; }} /><span>{busy ? "Uploading…" : image ? "Replace image" : "Choose image"}</span></label>
      <label htmlFor={`${dom(id)}-alt`} className="ed-sublabel">Description for screen readers</label>
      <input id={`${dom(id)}-alt`} className="ed-input" type="text" autoComplete="off" value={alt} onChange={(event) => { setAlt(event.target.value); if (image) commit({ ...image, alt: event.target.value }); }} /></div>
    {error && <p className="ed-error" role="alert">{error}.</p>}
  </div>;
}

const GROUPED = ["font", "order", "list", "image"];
const CONTROLS = { text: TextControl, url: UrlControl, color: ColorControl, length: NumberControl, number: NumberControl, font: FontControl, order: OrderControl, list: ListControl, image: ImageControl } as Record<string, (props: { id: string; def: SlotDef; labelled: string }) => ReactNode>;
/** One slot in the panel: its label, a reset-to-default button, the control for its kind, and any error the server reported. */
export function Field({ id }: { id: string }) {
  const def = useEd((s) => s.slots[id]), epoch = useEd((s) => s.epoch), changed = useEd((s) => Object.hasOwn(s.draft, id)), atDefault = useEd((s) => isDefault(id, s)), refused = useEd((s) => s.errors[id]);
  if (!def) return null;
  const labelled = `${dom(id)}-label`, grouped = GROUPED.includes(def.kind), props = { id, labelled }, Control = CONTROLS[def.kind];
  return <div className="ed-field" data-kind={def.kind} data-changed={changed || undefined}>
    <div className="ed-field-head">{grouped ? <span id={labelled} className="ed-label">{def.label}</span> : <label id={labelled} className="ed-label" htmlFor={dom(id)}>{def.label}</label>}{changed && <span className="ed-dot" role="img" aria-label="Unpublished change" />}
      <button type="button" className="ed-icon ed-reset" aria-label={`Reset ${def.label} to its default`} title="Reset to default" aria-disabled={atDefault} tabIndex={atDefault ? -1 : 0} onClick={() => { if (!atDefault) setValue(id, null, true); }}>{Icon.reset}</button></div>
    {Control && <Control key={epoch} def={def} {...props} />}
    {refused && <p className="ed-error" role="alert">The server did not accept this: it {refused}.</p>}
  </div>;
}
