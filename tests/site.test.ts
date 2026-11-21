import { test } from "node:test";
import assert from "node:assert/strict";
import content from "../src/site/content.json";
import theme from "../src/site/theme.json";
import { cssValue, defaults, fonts, resolveSite, slots, themeCss, validateValue, type SlotDef } from "../src/site/schema";
import { getSite } from "../src/site";
import { devOwner, getOwner, requireOwner } from "../src/lib/auth";

const accepts = (def: SlotDef, value: unknown) => assert.equal(validateValue(def, value).ok, true, `expected ${JSON.stringify(value)} to be accepted`);
const rejects = (def: SlotDef, ...values: unknown[]) => { for (const value of values) assert.equal(validateValue(def, value).ok, false, `expected ${JSON.stringify(value)} to be rejected`); };
const base = { label: "x", group: "x" };

test("every content and theme key has a slot definition and a valid default, and nothing else is registered", () => {
  assert.deepEqual(Object.keys(slots).sort(), [...Object.keys(content), ...Object.keys(theme)].sort());
  for (const id of Object.keys(slots)) {
    assert.match(id, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    assert.deepEqual(validateValue(slots[id], defaults[id]), { ok: true, value: defaults[id] }, id);
  }
  for (const id of Object.keys(theme)) assert.ok(id.startsWith("theme."), id);
  for (const id of Object.keys(content)) assert.ok(!id.startsWith("theme."), id);
  assert.deepEqual(resolveSite(), { values: defaults, dropped: [] });
});

test("text, url, color, and font slots accept only clean values of their kind", () => {
  const text: SlotDef = { ...base, kind: "text", max: 10 };
  accepts(text, ""); accepts(text, "héllo <b>");
  rejects(text, "eleven char", "two\nlines", "nul\u0000", "tab\t", 5, null, undefined, ["a"], { toString: () => "a" });
  accepts({ ...text, multiline: true }, "two\nlines");
  rejects({ ...text, multiline: true }, "cr\r\nlf");

  const url: SlotDef = { ...base, kind: "url" };
  accepts(url, "https://example.com/a?b=c"); accepts(url, "http://example.com"); accepts(url, "mailto:a@example.com");
  rejects(url, "javascript:alert(1)", " JaVaScRiPt:alert(1)", "data:text/html,<script>", "vbscript:x", "/relative", "//example.com", "", "example.com", `https://example.com/${"a".repeat(2000)}`, 7, null, { href: "https://example.com" });

  const color: SlotDef = { ...base, kind: "color" };
  accepts(color, "#abc"); accepts(color, "#A1B2C3");
  assert.deepEqual(validateValue(color, "#A1B2C3"), { ok: true, value: "#a1b2c3" });
  rejects(color, "red", "red;}body{display:none", "#fff;}body{display:none}", "#abcd", "#abcdef12", "#ggg", "rgb(0,0,0)", "url(https://example.com)", "var(--ink)", "#fff\n", " #fff", 0xffffff, null, ["#fff"]);

  const font: SlotDef = { ...base, kind: "font" };
  for (const key of Object.keys(fonts)) accepts(font, key);
  rejects(font, "comic-sans", "Figtree", "toString", "__proto__", "constructor", "figtree;}", "", 1, null);
});

test("length and number slots accept only finite numbers in range", () => {
  const length: SlotDef = { ...base, kind: "length", min: 14, max: 22, unit: "px" }, number: SlotDef = { ...base, kind: "number", min: 1.2, max: 2, step: 0.05 };
  for (const def of [length, number]) rejects(def, NaN, Infinity, -Infinity, "18", "18px", "18;}", null, undefined, [18], { valueOf: () => 18 }, true);
  accepts(length, 14); accepts(length, 22); accepts(length, 17.5); rejects(length, 13.99, 22.01, -18, 1e9);
  accepts(number, 1.2); accepts(number, 2); rejects(number, 1.19, 2.01, 0);
});

test("order slots accept only distinct known items", () => {
  const order: SlotDef = { ...base, kind: "order", items: ["a", "b", "c"] };
  accepts(order, ["c", "a"]); accepts(order, []); accepts(order, ["a", "b", "c"]);
  rejects(order, ["a", "d"], ["a", "a"], ["a", 1], "a", { 0: "a", length: 1 }, null, [["a"]]);
});

test("list slots enforce item shape, ids, field kinds, and maxItems", () => {
  const list: SlotDef = { ...base, kind: "list", maxItems: 2, fields: { name: { kind: "text", label: "Name", max: 5 }, url: { kind: "url", label: "Link", optional: true }, home: { kind: "url", label: "Home" } } };
  const item = { id: "a", name: "A", url: "", home: "https://example.com/" };
  accepts(list, []); accepts(list, [item, { ...item, id: "b-2", url: "mailto:a@example.com" }]);
  rejects(list,
    [item, { ...item, id: "b" }, { ...item, id: "c" }], // over maxItems
    [{ ...item, extra: "x" }], [{ ...item, __html: "<script>" }], // extra fields
    [{ id: "a", name: "A", url: "" }], // missing field
    [item, item], [{ ...item, id: "" }], [{ ...item, id: "A b" }], [{ ...item, id: 1 }], [{ ...item, id: "a".repeat(41) }], // ids
    [{ ...item, name: "too long" }], [{ ...item, name: 5 }], [{ ...item, name: ["A"] }], // text field
    [{ ...item, url: "javascript:alert(1)" }], [{ ...item, home: "" }], [{ ...item, home: "/x" }], // url fields; only an optional one may be empty
    [null], ["a"], [[item]], item, "list", null);
});

test("image slots need an https url, integer dimensions, and plain alt text", () => {
  const image: SlotDef = { ...base, kind: "image" }, value = { url: "https://example.com/a.jpg", width: 1200, height: 800, alt: "A photo" };
  accepts(image, value); accepts(image, { ...value, alt: "" });
  rejects(image, { ...value, url: "http://example.com/a.jpg" }, { ...value, url: "javascript:alert(1)" }, { ...value, width: 0 }, { ...value, height: 1.5 }, { ...value, width: "1200" }, { ...value, alt: 1 }, { ...value, alt: "a\nb" }, { ...value, onload: "x" }, { url: value.url }, value.url, null);
});

test("validateValue never throws, whatever it is handed", () => {
  const hostile = [Object.create(null), new Proxy({}, { get() { throw new Error("trap"); }, ownKeys() { throw new Error("trap"); } }), Symbol("s"), () => 1, BigInt(10), new Date(), [new Proxy({}, { getPrototypeOf() { throw new Error("trap"); } })]];
  for (const def of Object.values(slots)) for (const value of hostile) assert.equal(validateValue(def, value).ok, false);
  assert.equal(validateValue({ ...base, kind: "bogus" } as unknown as SlotDef, "x").ok, false);
});

test("resolveSite applies valid overlay entries and drops unknown or invalid ones back to the default", () => {
  const { values, dropped } = resolveSite({
    "site.wordmark": "Hello", "theme.link": "#ABCDEF", "home.order": ["links", "writing"], "theme.font-size": 20,
    "site.nope": "x", "theme.ink": "red;}body{display:none", "theme.font-body": "papyrus", "theme.page-width": 99999, "home.links.items": [{ id: "x", label: "x", url: "javascript:alert(1)" }], "home.intro": 5, "__proto__x": 1, toString: "x",
  });
  assert.equal(values["site.wordmark"], "Hello");
  assert.equal(values["theme.link"], "#abcdef");
  assert.deepEqual(values["home.order"], ["links", "writing"]);
  assert.equal(values["theme.font-size"], 20);
  assert.deepEqual(dropped.sort(), ["__proto__x", "home.intro", "home.links.items", "site.nope", "theme.font-body", "theme.ink", "theme.page-width", "toString"]);
  for (const id of ["theme.ink", "theme.font-body", "theme.page-width", "home.links.items", "home.intro"]) assert.deepEqual(values[id], defaults[id], id);
  assert.equal(Object.keys(values).length, Object.keys(defaults).length);
  assert.notEqual(values["home.projects.items"], defaults["home.projects.items"], "values are a copy, so callers cannot mutate the defaults");
  for (const overlay of [null, "x", [1], 5]) assert.deepEqual(resolveSite(overlay as never), { values: defaults, dropped: [] });
});

test("themeCss declares exactly the theme tokens, from validated values only", () => {
  const css = themeCss(defaults);
  assert.match(css, /^:root\{(--[a-z-]+:[^;{}]+;)+\}$/);
  assert.equal(css.match(/--[a-z-]+:/g)?.length, Object.keys(theme).length);
  for (const expected of ["--ink:#302723;", "--bg:#ffffff;", "--font-body:var(--font-sans), sans-serif;", "--font-size:18px;", "--line-height:1.55;", "--page-width:1220px;", "--radius:4px;"]) assert.ok(css.includes(expected), expected);
  assert.ok(themeCss({ ...defaults, "theme.link": "#123456", "theme.font-heading": "newsreader", "theme.section-gap": 20.123456 }).includes("--link:#123456;") );
  assert.ok(themeCss({ ...defaults, "theme.section-gap": 20.123456 }).includes("--section-gap:20.1235px;"));
  // Unvalidated input (a caller bypassing resolveSite) still cannot reach the stylesheet: each bad value falls back to its default.
  const hostile = themeCss({ "theme.ink": "red;}body{display:none}", "theme.bg": "#fff</style><script>alert(1)</script>", "theme.font-body": "x;}*{color:red", "theme.font-size": "18px;}html{display:none", "theme.line-height": NaN, "theme.radius": 1e308, "theme.page-width": { toString: () => "1px}" } });
  assert.equal(hostile, css);
  assert.equal(themeCss(null as never), css);
});

test("no accepted theme value can break out of its declaration", () => {
  const samples: Record<string, unknown[]> = { color: ["#000", "#FFFFFF", "#a1b2c3"], font: Object.keys(fonts) };
  for (const [id, def] of Object.entries(slots).filter(([id]) => id.startsWith("theme."))) {
    assert.ok(["color", "font", "length", "number"].includes(def.kind), `${id} must be a CSS-valued kind`);
    const values = def.kind === "length" || def.kind === "number" ? [def.min, def.max, (def.min + def.max) / 2, def.min + 1e-7, def.max - 1e-9] : samples[def.kind];
    for (const value of values) {
      const out = cssValue(def, value);
      assert.match(out ?? "", /^[#a-z0-9.,() -]+$/i, `${id}=${String(value)} → ${out}`);
      assert.doesNotMatch(out ?? "", /e[+-]?\d|url\(|expression/i);
      assert.ok(themeCss({ ...defaults, [id]: value }).includes(`--${id.slice(6)}:${out};`));
    }
  }
  for (const { stack } of Object.values(fonts)) assert.match(stack, /^[a-z(), -]+$/i);
  assert.equal(cssValue(slots["site.title"], "x"), undefined);
});

test("getSite serves defaults through typed helpers when no overlay is published", async () => {
  const site = await getSite();
  assert.equal(site.text("site.wordmark"), "Austin");
  assert.deepEqual(site.order("home.order"), ["writing", "photos", "projects", "work", "links"]);
  assert.deepEqual(site.list("home.projects.items").map((p) => p.name), ["pianosu", "scanlate.io", "One Word", "Glowflow"]);
  assert.equal(site.value<number>("theme.font-size"), 18);
  assert.throws(() => site.text("site.nope"), /Unknown slot/);
});

test("the dev owner exists only outside production with EDITOR_DEV_OWNER=1", async () => {
  assert.equal(devOwner({ NODE_ENV: "production", EDITOR_DEV_OWNER: "1" }), null);
  assert.equal(devOwner({ NODE_ENV: "development" }), null);
  assert.equal(devOwner({ NODE_ENV: "development", EDITOR_DEV_OWNER: "true" }), null);
  assert.equal(devOwner({ NODE_ENV: "development", EDITOR_DEV_OWNER: "1" })?.id, "dev-owner");
  assert.equal(await getOwner(new Headers(), { NODE_ENV: "production", EDITOR_DEV_OWNER: "1" }), null);
  const request = new Request("https://example.com/api/overlay", { method: "POST" });
  assert.equal((await requireOwner(request, { NODE_ENV: "test", EDITOR_DEV_OWNER: "1" })).name, "Dev owner");
  await assert.rejects(requireOwner(request, {}), (thrown) => thrown instanceof Response && thrown.status === 401);
});
