import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, baseValues, blankItem, cleanText, encodeAsk, fitWithin, hex6, itemId, layer, listAdd, listRemove, listSet, move, parseDraft, pruneDraft, publishOverlay, relativeTime, same, setDraft, slug, summarise, toggleOrder, type Check, type Def, type Item } from "../src/editor/draft";
import { defaults, slots, validateValue } from "../src/site/schema";

const defs = slots as unknown as Record<string, Def>, check = validateValue as unknown as Check;
const base = (overlay = {}) => baseValues(defs, defaults, overlay, check);

test("base values are defaults with valid published entries, failing closed on bad ones", () => {
  const values = base({ "home.intro": "Hello", "theme.link": "#ABCDEF", "theme.bg": "red", "nope.slot": 1 });
  assert.equal(values["home.intro"], "Hello");
  assert.equal(values["theme.link"], "#abcdef");
  assert.equal(values["theme.bg"], defaults["theme.bg"]);
  assert.equal(Object.hasOwn(values, "nope.slot"), false);
  assert.deepEqual(Object.keys(values).sort(), Object.keys(slots).sort());
});

test("the draft layers over the published values, and null means the code default", () => {
  const published = base({ "home.intro": "Published", "theme.link": "#112233" });
  const values = layer(published, defaults, { "home.intro": "Draft", "theme.link": null, "ghost.slot": "x" });
  assert.equal(values["home.intro"], "Draft");
  assert.equal(values["theme.link"], defaults["theme.link"]);
  assert.equal(Object.hasOwn(values, "ghost.slot"), false);
  assert.equal(published["home.intro"], "Published", "layering does not mutate the base");
});

test("setting a slot back to what is published removes it from the draft", () => {
  const published = base({ "home.intro": "Published" });
  let draft = setDraft({}, "home.intro", "Edited", published, defaults);
  assert.deepEqual(draft, { "home.intro": "Edited" });
  draft = setDraft(draft, "home.intro", "Published", published, defaults);
  assert.deepEqual(draft, {});
  assert.deepEqual(setDraft({}, "home.intro", null, published, defaults), { "home.intro": null }, "reset of an overridden slot stores null");
  assert.deepEqual(setDraft({ "site.wordmark": "x" }, "site.wordmark", null, published, defaults), {}, "reset of an unpublished slot is no change");
  assert.deepEqual(setDraft({}, "home.order", [...(defaults["home.order"] as string[])], published, defaults), {}, "equality is structural");
});

test("pruning drops unknown, invalid, and redundant draft entries and normalizes the rest", () => {
  const published = base({ "home.intro": "Published" });
  const draft = pruneDraft({ "home.intro": "Published", "site.wordmark": "A\u0007", "theme.link": "#ABC", "theme.bg": null, "home.work.body": null, "old.slot": "x", "site.footer": "New" }, defs, published, defaults, check);
  assert.deepEqual(draft, { "theme.link": "#abc", "site.footer": "New" });
  assert.deepEqual(pruneDraft({ "home.intro": null }, defs, published, defaults, check), { "home.intro": null });
});

test("a stored draft that is not a plain object reads as empty", () => {
  for (const text of [null, undefined, "", "nope", "[1]", "null", "3", "\"x\""]) assert.deepEqual(parseDraft(text), {});
  assert.deepEqual(parseDraft("{\"a\":null,\"b\":1}"), { a: null, b: 1 });
});

test("publishing a draft merges values and removes null entries", () => {
  const overlay = { "home.intro": "Old", "theme.link": "#111111" };
  assert.deepEqual(publishOverlay(overlay, { "home.intro": null, "site.footer": "F" }), { "theme.link": "#111111", "site.footer": "F" });
  assert.deepEqual(overlay, { "home.intro": "Old", "theme.link": "#111111" });
  assert.ok(same(base(publishOverlay(overlay, { "home.intro": null }))["home.intro"], defaults["home.intro"]));
});

test("an order value becomes a DOM arrangement: visible first in slot order, hidden after in registry order", () => {
  const items = ["writing", "photos", "projects", "work", "links"];
  assert.deepEqual(arrange(items, ["links", "writing"]), { ids: ["links", "writing", "photos", "projects", "work"], hidden: ["photos", "projects", "work"] });
  assert.deepEqual(arrange(items, items), { ids: items, hidden: [] });
  assert.deepEqual(arrange(items, ["work", "bogus", "work"]), { ids: ["work", "writing", "photos", "projects", "links"], hidden: ["writing", "photos", "projects", "links"] });
  assert.deepEqual(toggleOrder(["writing", "photos"], "photos"), ["writing"]);
  assert.deepEqual(toggleOrder(["writing"], "links"), ["writing", "links"]);
  for (const order of [["links", "writing"], [], items]) assert.ok(validateValue(slots["home.order"], arrange(items, order).ids.filter((id) => !arrange(items, order).hidden.includes(id))).ok);
});

test("move reorders without mutating and ignores out-of-range moves", () => {
  const list = ["a", "b", "c", "d"];
  assert.deepEqual(move(list, 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(move(list, 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(move(list, 1, 1), list);
  assert.deepEqual(move(list, -1, 2), list);
  assert.deepEqual(move(list, 1, 4), list);
  assert.deepEqual(list, ["a", "b", "c", "d"]);
});

test("list operations keep values valid for the real list slots", () => {
  const def = slots["home.projects.items"], projects = defaults["home.projects.items"] as Item[];
  assert.ok(def.kind === "list");
  const fresh = blankItem(def.fields, projects, "New project");
  assert.deepEqual(fresh, { id: "new", name: "New project", blurb: "", url: "" });
  let list = listAdd(projects, fresh);
  assert.equal(blankItem(def.fields, list).id, "new-2");
  list = listSet(list, "new", "blurb", "A thing");
  list = move(list, list.length - 1, 0);
  assert.equal(list[0].blurb, "A thing");
  assert.ok(validateValue(def, list).ok);
  assert.deepEqual(listRemove(list, "new").map((item) => item.id), projects.map((item) => item.id));
  assert.equal(projects.length, 4, "the defaults were not mutated");
  const links = slots["home.links.items"];
  assert.ok(links.kind === "list");
  const link = blankItem(links.fields, []);
  assert.deepEqual(link, { id: "new", label: "Untitled", url: "https://" });
  assert.equal(validateValue(links, [link]).ok, false, "a required link must be completed before it validates");
  assert.ok(validateValue(links, listSet([link], "new", "url", "https://example.com")).ok);
});

test("item ids are unique slugs", () => {
  assert.equal(slug("  Héllo, Wörld!  "), "hello-world");
  assert.equal(slug("***"), "");
  assert.equal(itemId([], "One Word"), "one-word");
  assert.equal(itemId([{ id: "one-word" }, { id: "one-word-2" }], "One Word"), "one-word-3");
  assert.equal(itemId([], ""), "item");
  assert.match(itemId([], "x".repeat(80)), /^[a-z0-9][a-z0-9-]{0,39}$/);
});

test("text typed in the page is cleaned into something the validator accepts", () => {
  assert.equal(cleanText("  Hello\tthere\u00a0you \n"), "Hello there you");
  assert.equal(cleanText("one\r\ntwo\n\nthree"), "one two three");
  assert.equal(cleanText("one  \r\ntwo\n\n", true), "one\ntwo");
  assert.ok(validateValue(slots["home.intro"], cleanText("a\u0001b\u2028c\n", true)).ok);
  assert.ok(validateValue(slots["site.wordmark"], cleanText("a\nb\u0007")).ok);
});

test("the publish summary names the first slots and counts the rest", () => {
  assert.equal(summarise({ "home.intro": "x" }, defs), "Edited intro");
  assert.equal(summarise({ "home.intro": "x", "theme.link": "#000", "theme.bg": "#fff", "site.footer": "f" }, defs), "Edited intro, links and accent, 2 more");
  assert.equal(summarise({ "site.title": "x" }, defs), "Edited site title");
  assert.equal(summarise({ "home.intro": null, "theme.link": null }, defs), "Reset intro, links and accent");
  assert.equal(summarise({ "home.intro": null, "theme.link": "#000" }, defs), "Edited intro, links and accent");
  assert.equal(summarise({ "mystery.slot": 1 }, defs), "Edited mystery.slot");
  assert.equal(summarise({}, defs), "No changes");
  assert.ok(summarise({ a: 1 }, { a: { kind: "text", group: "", label: "y".repeat(400) } }).length <= 200);
});

test("relative times", () => {
  const now = Date.parse("2026-11-21T12:00:00Z"), ago = (seconds: number) => relativeTime(new Date(now - seconds * 1000).toISOString(), now);
  assert.equal(ago(5), "just now");
  assert.equal(ago(-60), "just now", "a clock a little ahead never reads as the future");
  assert.equal(ago(60), "1 minute ago");
  assert.equal(ago(59 * 60), "59 minutes ago");
  assert.equal(ago(2 * 3600), "2 hours ago");
  assert.equal(ago(3 * 86400), "3 days ago");
  assert.equal(ago(90 * 86400), "Aug 23, 2026");
  assert.equal(relativeTime("not a date", now), "");
});

test("the Ask Claude context is base64url JSON that survives non-ASCII text", () => {
  const decode = (text: string) => JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  const encoded = encodeAsk({ route: "/posts/héllo", slot: "home.intro", text: "naïve — “quotes” ✳" });
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decode(encoded), { route: "/posts/héllo", slot: "home.intro", text: "naïve — “quotes” ✳" });
  assert.deepEqual(decode(encodeAsk({ route: "/", slot: "", text: "" })), { route: "/" });
  assert.equal(decode(encodeAsk({ route: "/", text: "x".repeat(900) })).text.length, 500);
});

test("image sizes fit within a bound without upscaling, and short hex colours expand", () => {
  assert.deepEqual(fitWithin(4000, 3000, 2400), { width: 2400, height: 1800 });
  assert.deepEqual(fitWithin(3000, 4000, 2400), { width: 1800, height: 2400 });
  assert.deepEqual(fitWithin(800, 600, 2400), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(10000, 1, 100), { width: 100, height: 1 });
  assert.equal(hex6("#ABC"), "#aabbcc");
  assert.equal(hex6("#A1B2C3"), "#a1b2c3");
});
