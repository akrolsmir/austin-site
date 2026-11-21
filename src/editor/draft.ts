// The editor's pure logic: layering a draft over the published overlay, diffing, section order, list operations, and the
// one-line publish summary. Dependency-free on purpose (the validator is passed in) so it is unit-tested without a DOM.
export type Values = Record<string, unknown>;
/** Unpublished changes: a value, or null for "back to the code default". */
export type Draft = Record<string, unknown>;
export type Def = { kind: string; label: string; group: string; [key: string]: unknown };
export type Check = (def: never, value: unknown) => { ok: true; value: unknown } | { ok: false; error: string };
export type Item = { id: string } & Record<string, string>;
type Field = { kind: string; label: string; max?: number; optional?: boolean };

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const valid = (check: Check, def: Def, value: unknown) => check(def as never, value);
/** Values are validator-normalized JSON, so structural equality is a string compare. */
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What the server renders: defaults with each valid published entry applied (invalid or unknown entries fall back, like resolveSite). */
export function baseValues(slots: Record<string, Def>, defaults: Values, overlay: Values, check: Check): Values {
  const values: Values = {};
  for (const id of Object.keys(slots)) {
    const result = Object.hasOwn(overlay, id) ? valid(check, slots[id], overlay[id]) : undefined;
    values[id] = result?.ok ? result.value : defaults[id];
  }
  return values;
}
/** What the owner sees: the published values with the draft on top (null means the code default). */
export function layer(base: Values, defaults: Values, draft: Draft): Values {
  const values = { ...base };
  for (const [id, value] of Object.entries(draft)) if (Object.hasOwn(base, id)) values[id] = value === null ? defaults[id] : value;
  return values;
}
/** The draft after setting one slot. An edit that lands back on the published value is no change at all. */
export function setDraft(draft: Draft, id: string, value: unknown, base: Values, defaults: Values): Draft {
  const next = { ...draft };
  if (same(value === null ? defaults[id] : value, base[id])) delete next[id]; else next[id] = value;
  return next;
}
/** Reads whatever localStorage held; anything that is not a plain object is an empty draft. */
export function parseDraft(text: string | null | undefined): Draft {
  try { const parsed: unknown = JSON.parse(text ?? ""); return plain(parsed) ? parsed : {}; } catch { return {}; }
}
/** Drops draft entries that no longer mean anything: unknown slots, values the validator refuses, and edits equal to what is published. */
export function pruneDraft(draft: Draft, slots: Record<string, Def>, base: Values, defaults: Values, check: Check): Draft {
  let next: Draft = {};
  for (const [id, value] of Object.entries(draft)) {
    if (!Object.hasOwn(slots, id)) continue;
    const result = value === null ? { ok: true as const, value: null } : valid(check, slots[id], value);
    if (result.ok) next = setDraft(next, id, result.value, base, defaults);
  }
  return next;
}
/** The overlay a successful publish of `draft` leaves behind (null removes the entry). */
export function publishOverlay(overlay: Values, draft: Draft): Values {
  const next = { ...overlay };
  for (const [id, value] of Object.entries(draft)) if (value === null) delete next[id]; else next[id] = value;
  return next;
}

// Order slots: the value lists the visible items in display order; an item left out is hidden.
export const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};
/** DOM arrangement for an order value: visible ids in slot order, then hidden ones in registry order. */
export function arrange(items: readonly string[], order: readonly string[]): { ids: string[]; hidden: string[] } {
  const visible = order.filter((id, index) => items.includes(id) && order.indexOf(id) === index), hidden = items.filter((id) => !visible.includes(id));
  return { ids: [...visible, ...hidden], hidden };
}
/** Hides a visible item or shows a hidden one (a shown item returns at the end). */
export const toggleOrder = (order: readonly string[], id: string): string[] => order.includes(id) ? order.filter((item) => item !== id) : [...order, id];

// List slots.
export const slug = (text: string) => text.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
/** A unique item id (`[a-z0-9][a-z0-9-]{0,39}`) seeded from some text. */
export function itemId(list: readonly Item[], seed = ""): string {
  const base = slug(seed) || "item", taken = new Set(list.map((item) => item.id));
  for (let n = 1; ; n++) { const id = n === 1 ? base : `${base}-${n}`; if (!taken.has(id)) return id; }
}
/** A blank item for a list slot: the first text field gets `title`, a required link gets a placeholder to complete. */
export function blankItem(fields: Record<string, Field>, list: readonly Item[], title = "Untitled"): Item {
  const item: Item = { id: itemId(list, "new") }, first = Object.keys(fields).find((name) => fields[name].kind === "text");
  for (const [name, field] of Object.entries(fields)) item[name] = name === first ? title : field.kind === "url" && !field.optional ? "https://" : "";
  return item;
}
export const listAdd = (list: readonly Item[], item: Item): Item[] => [...list, item];
export const listRemove = (list: readonly Item[], id: string): Item[] => list.filter((item) => item.id !== id);
export const listSet = (list: readonly Item[], id: string, field: string, value: string): Item[] => list.map((item) => item.id === id ? { ...item, [field]: value } : item);

/** Text as typed in the page, made storable: control characters become spaces, newlines survive only in multiline slots, edges trimmed. */
export function cleanText(text: string, multiline = false): string {
  const lines = text.replace(/\r\n?|[\u2028\u2029]/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/\u00a0/g, " ");
  return (multiline ? lines.replace(/[ \t]+\n/g, "\n") : lines.replace(/\n+/g, " ")).trim();
}

const name = (def: Def | undefined, id: string) => (def?.label ?? id).replace(/\s*\(.*?\)\s*/g, " ").trim().toLowerCase();
/** "Edited intro, accent colour, 2 more": the history line for a publish. At most 200 characters. */
export function summarise(draft: Draft, slots: Record<string, Def>, shown = 2): string {
  const ids = Object.keys(draft);
  if (!ids.length) return "No changes";
  const verb = ids.every((id) => draft[id] === null) ? "Reset" : "Edited", names = ids.slice(0, shown).map((id) => name(slots[id], id)), rest = ids.length - names.length;
  const text = `${verb} ${[...names, ...(rest ? [`${rest} more`] : [])].join(", ")}`;
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** "just now", "5 minutes ago", "3 days ago", then a date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000)), units: Array<[number, string]> = [[60, "minute"], [3600, "hour"], [86400, "day"]];
  if (seconds < 45) return "just now";
  if (seconds >= 30 * 86400) return new Date(then).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  const [size, unit] = [...units].reverse().find(([size]) => seconds >= size) ?? units[0], count = Math.max(1, Math.round(seconds / size));
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

export { encodeAsk } from "../lib/studio/types";
/** Scales a size down (never up) so its longer edge is at most `max`. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
/** #rgb → #rrggbb (what <input type="color"> needs). */
export const hex6 = (color: string) => /^#[0-9a-f]{3}$/i.test(color) ? `#${[...color.slice(1)].map((c) => c + c).join("")}`.toLowerCase() : color.toLowerCase();
