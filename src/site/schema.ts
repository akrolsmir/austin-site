import { safeUrl } from "../lib/types";
import content from "./content.json";
import theme from "./theme.json";

// The slot registry: every editable value on the site, its kind, and its constraints. Pure (no server or DOM imports) so the
// server, the editor bundle, and tests share one validator. Contract: docs/editable-site.md, "Slots".
export type SlotKind = "text" | "url" | "image" | "color" | "length" | "number" | "font" | "order" | "list";
export type ListField = { kind: "text" | "url"; label: string; max?: number; optional?: boolean };
export type SlotDef = { label: string; group: string } & (
  | { kind: "text"; max: number; multiline?: boolean }
  | { kind: "url" | "image" | "color" | "font" }
  | { kind: "length"; min: number; max: number; unit: "px" | "rem" | "em" | "" }
  | { kind: "number"; min: number; max: number; step: number }
  | { kind: "order"; items: string[] }
  | { kind: "list"; fields: Record<string, ListField>; maxItems: number });
export type ImageValue = { url: string; width: number; height: number; alt: string };
export type ListItem = { id: string } & Record<string, string>;
export type Overlay = Record<string, unknown>;
export type Validated = { ok: true; value: unknown } | { ok: false; error: string };

// Font keys map to CSS stacks; src/site/fonts.ts loads the matching next/font variables onto <html>.
export const fonts: Record<string, { label: string; stack: string }> = {
  figtree: { label: "Figtree", stack: "var(--font-sans), sans-serif" },
  inter: { label: "Inter", stack: "var(--font-inter), sans-serif" },
  "instrument-sans": { label: "Instrument Sans", stack: "var(--font-instrument-sans), sans-serif" },
  "source-serif": { label: "Source Serif", stack: "var(--font-source-serif), Georgia, serif" },
  newsreader: { label: "Newsreader", stack: "var(--font-newsreader), Georgia, serif" },
  system: { label: "System sans", stack: "ui-sans-serif, system-ui, sans-serif" },
  georgia: { label: "Georgia", stack: "Georgia, serif" },
};

const text = (label: string, group: string, max = 80, multiline = false): SlotDef => ({ kind: "text", label, group, max, multiline });
const color = (label: string): SlotDef => ({ kind: "color", label, group: "Colors" });
const px = (label: string, group: string, min: number, max: number): SlotDef => ({ kind: "length", label, group, min, max, unit: "px" });
export const slots: Record<string, SlotDef> = {
  "site.title": text("Site title (browser tab)", "Site"),
  "site.description": text("Site description", "Site", 200),
  "site.wordmark": text("Wordmark", "Site", 40),
  "site.footer": text("Footer", "Site", 120),
  "nav.writing": text("Writing link", "Navigation", 30),
  "nav.projects": text("Projects link", "Navigation", 30),
  "nav.work": text("Work link", "Navigation", 30),
  "nav.links": text("Links link", "Navigation", 30),
  "nav.photos": text("Photos link", "Navigation", 30),
  "home.intro": text("Intro", "Home", 1000, true),
  "home.order": { kind: "order", label: "Sections", group: "Home", items: ["writing", "photos", "projects", "work", "links"] },
  "home.writing.heading": text("Writing heading", "Home"),
  "home.writing.more": text("All posts link", "Home", 40),
  "home.photos.heading": text("Photos heading", "Home"),
  "home.photos.more": text("All photos link", "Home", 40),
  "home.projects.heading": text("Projects heading", "Home"),
  "home.projects.items": { kind: "list", label: "Projects", group: "Home", maxItems: 12, fields: { name: { kind: "text", label: "Name", max: 60 }, blurb: { kind: "text", label: "Blurb", max: 300 }, url: { kind: "url", label: "Link", optional: true } } },
  "home.work.heading": text("Work heading", "Home"),
  "home.work.body": text("Work", "Home", 1000, true),
  "home.links.heading": text("Links heading", "Home"),
  "home.links.items": { kind: "list", label: "Links", group: "Home", maxItems: 20, fields: { label: { kind: "text", label: "Label", max: 80 }, url: { kind: "url", label: "Link" } } },
  "posts.heading": text("Posts page heading", "Pages"),
  "photos.heading": text("Photos page heading", "Pages"),
  "theme.ink": color("Text"),
  "theme.link": color("Links and accent"),
  "theme.muted": color("Muted text"),
  "theme.line": color("Hairlines"),
  "theme.surface": color("Surfaces"),
  "theme.bg": color("Page background"),
  "theme.font-body": { kind: "font", label: "Body font", group: "Type" },
  "theme.font-heading": { kind: "font", label: "Heading font", group: "Type" },
  "theme.font-size": px("Base size", "Type", 14, 22),
  "theme.line-height": { kind: "number", label: "Line height", group: "Type", min: 1.2, max: 2, step: 0.05 },
  "theme.wordmark-size": px("Wordmark size", "Type", 32, 120),
  "theme.heading-size": px("Heading size", "Type", 18, 48),
  "theme.post-title-size": px("Post title size", "Type", 28, 72),
  "theme.prose-size": px("Post text size", "Type", 15, 24),
  "theme.prose-line-height": { kind: "number", label: "Post line height", group: "Type", min: 1.3, max: 2.2, step: 0.05 },
  "theme.page-width": px("Page width", "Layout", 720, 1600),
  "theme.page-padding": px("Page padding", "Layout", 16, 96),
  "theme.section-gap": px("Section gap", "Layout", 16, 96),
  "theme.radius": px("Corner radius", "Layout", 0, 24),
};
export const defaults: Record<string, unknown> = { ...content, ...theme };

const ok = (value: unknown): Validated => ({ ok: true, value });
const no = (error: string): Validated => ({ ok: false, error });
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
// Control characters never belong in copy; a newline is allowed only in multiline text.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/;
function checkText(value: unknown, max: number, multiline = false): Validated {
  if (typeof value !== "string") return no("must be text");
  if (value.length > max) return no(`must be at most ${max} characters`);
  if (CONTROL.test(value) || (!multiline && value.includes("\n"))) return no("contains a character that is not allowed");
  return ok(value);
}
function checkUrl(value: unknown, https = false): Validated {
  const url = typeof value === "string" && value.length <= 2000 ? safeUrl(value) : undefined;
  return url && (!https || url.startsWith("https://")) ? ok(url) : no(https ? "must be an https link" : "must be an http, https, or mailto link");
}
const checkNumber = (value: unknown, min: number, max: number): Validated => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? ok(value) : no(`must be a number from ${min} to ${max}`);
const size = (value: unknown) => Number.isInteger(value) && (value as number) > 0 && (value as number) <= 20000;

/** Strict and pure: returns the (normalized) value or the reason it was refused. Never throws. */
export function validateValue(def: SlotDef, value: unknown): Validated {
  try {
    switch (def.kind) {
      case "text": return checkText(value, def.max, def.multiline);
      case "url": return checkUrl(value);
      case "color": return typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? ok(value.toLowerCase()) : no("must be a #rgb or #rrggbb color");
      case "length": case "number": return checkNumber(value, def.min, def.max);
      case "font": return typeof value === "string" && Object.hasOwn(fonts, value) ? ok(value) : no("must be one of the site's fonts");
      case "image": {
        if (!plain(value) || !exactKeys(value, ["url", "width", "height", "alt"])) return no("must be an image with url, width, height, and alt");
        const url = checkUrl(value.url, true), alt = checkText(value.alt, 300);
        if (!url.ok) return url;
        if (!alt.ok || !size(value.width) || !size(value.height)) return no("has an invalid size or alt text");
        return ok({ url: url.value, width: value.width, height: value.height, alt: alt.value });
      }
      case "order": {
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !def.items.includes(item))) return no(`must list only ${def.items.join(", ")}`);
        return new Set(value).size === value.length ? ok([...value]) : no("lists an item twice");
      }
      case "list": {
        if (!Array.isArray(value) || value.length > def.maxItems) return no(`must be a list of at most ${def.maxItems} items`);
        const names = Object.keys(def.fields), seen = new Set<string>(), items: ListItem[] = [];
        for (const item of value) {
          if (!plain(item) || !exactKeys(item, ["id", ...names])) return no(`each item needs exactly id, ${names.join(", ")}`);
          if (typeof item.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(item.id) || seen.has(item.id)) return no("item ids must be unique lowercase slugs");
          seen.add(item.id);
          const clean: ListItem = { id: item.id };
          for (const name of names) {
            const field = def.fields[name];
            const result = field.kind === "text" ? checkText(item[name], field.max ?? 200) : field.optional && item[name] === "" ? ok("") : checkUrl(item[name]);
            if (!result.ok) return no(`${field.label} ${result.error}`);
            clean[name] = result.value as string;
          }
          items.push(clean);
        }
        return ok(items);
      }
      default: return no("unknown slot kind");
    }
  } catch { return no("could not be read"); }
}

/** Defaults with each valid overlay entry applied; unknown slots and invalid values are dropped (fail closed to the default). */
export function resolveSite(overlay: Overlay = {}): { values: Record<string, unknown>; dropped: string[] } {
  const values = structuredClone(defaults), dropped: string[] = [];
  for (const [id, value] of plain(overlay) ? Object.entries(overlay) : []) {
    const result = Object.hasOwn(slots, id) ? validateValue(slots[id], value) : undefined;
    if (result?.ok) values[id] = result.value; else dropped.push(id);
  }
  return { values, dropped };
}

/** The CSS text for a validated theme value (what themeCss emits, and what the editor sets on <html> to preview a token). */
export function cssValue(def: SlotDef, value: unknown): string | undefined {
  const result = validateValue(def, value);
  if (!result.ok) return undefined;
  if (def.kind === "color") return result.value as string;
  if (def.kind === "font") return fonts[result.value as string].stack;
  if (def.kind === "length" || def.kind === "number") return `${Number((result.value as number).toFixed(4))}${def.kind === "length" ? def.unit : ""}`;
  return undefined;
}
export const cssVar = (id: string) => `--${id.slice("theme.".length)}`;
/** `:root{--token:value;…}` for every theme slot. A value that fails validation is replaced by its default, never emitted. */
export function themeCss(values: Record<string, unknown>): string {
  const rules = Object.entries(slots).filter(([id]) => id.startsWith("theme.")).map(([id, def]) => `${cssVar(id)}:${cssValue(def, values?.[id]) ?? cssValue(def, defaults[id])};`);
  return `:root{${rules.join("")}}`;
}
