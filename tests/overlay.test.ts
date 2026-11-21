import { test } from "node:test";
import assert from "node:assert/strict";
import { overlayHandlers } from "../src/app/api/overlay/handlers";
import { HEAD_PREFIX, HISTORY_CAP, OverlayConflict, OverlayDamaged, OverlayError, OverlayNotFound, OverlayUnavailable, overlayHash, overlayReader, overlayStore, versionPath } from "../src/lib/overlay";
import { POINTERS_KEPT } from "../src/lib/posts";
import { fakeBlob } from "./fake-blob";
import { defaults } from "../src/site/schema";

const ENV = { BLOB_READ_WRITE_TOKEN: "token" };
const OWNER = { ...ENV, NODE_ENV: "test", EDITOR_DEV_OWNER: "1" };
const META = { summary: "Edit", by: "editor" };

const setup = (env: Record<string, string | undefined> = ENV) => { const blob = fakeBlob(); return { blob, store: overlayStore(env, blob.api) }; };

test("publish merges patches, normalizes values, and null removes an entry", async () => {
  const { blob, store } = setup();
  const first = await store.publish({ "site.wordmark": "Hello", "theme.ink": "#ABCDEF" }, META);
  assert.equal(first.previous, null);
  assert.deepEqual(first.overlay, { "site.wordmark": "Hello", "theme.ink": "#abcdef" });
  assert.equal(first.hash, overlayHash(first.overlay));
  assert.match(first.hash, /^[0-9a-f]{16}$/);
  const second = await store.publish({ "site.footer": "Bye", "theme.ink": null }, { summary: "Second\nline", by: "studio:run1" });
  assert.equal(second.previous, first.hash);
  assert.deepEqual(second.overlay, { "site.wordmark": "Hello", "site.footer": "Bye" });
  const { overlay, head } = await store.read();
  assert.deepEqual(overlay, second.overlay);
  assert.equal(head.current, second.hash);
  assert.deepEqual(head.history.map(({ hash, summary, by }) => ({ hash, summary, by })), [{ hash: second.hash, summary: "Second line", by: "studio:run1" }, { hash: first.hash, summary: "Edit", by: "editor" }]);
  assert.deepEqual(JSON.parse(blob.files.get(versionPath(first.hash))!.text), first.overlay); // earlier versions stay as they were
  assert.equal((await store.publish({ "site.footer": "Bye" }, META)).hash, second.hash); // an unchanged overlay writes nothing
  assert.equal(blob.head().history.length, 2);
});

test("a publish with any invalid entry is rejected whole and leaves the head untouched", async () => {
  const { blob, store } = setup();
  const { hash } = await store.publish({ "site.wordmark": "Hello" }, META);
  const before = blob.pointer(HEAD_PREFIX), puts = blob.puts.length;
  const bad = { "site.footer": "fine", "theme.ink": "red", "nope.slot": "x", "theme.font-size": 999, "home.intro": "<b>ok as text</b>", __proto__: "x" };
  await assert.rejects(store.publish(bad, META), (error: OverlayError) => {
    assert.ok(error instanceof OverlayError);
    assert.deepEqual(Object.keys(error.errors).sort(), ["nope.slot", "theme.font-size", "theme.ink"]);
    assert.match(error.errors["theme.ink"], /color/);
    return true;
  });
  await assert.rejects(store.publish([] as never, META), OverlayError);
  await assert.rejects(store.publish(JSON.parse('{"__proto__":{"x":1},"constructor":"y"}'), META), OverlayError);
  assert.equal(blob.pointer(HEAD_PREFIX), before);
  assert.equal(blob.puts.length, puts);
  assert.equal((await store.read()).head.current, hash);
});

test("a concurrent publish loses with OverlayConflict, including the very first one", async () => {
  const { blob, store } = setup();
  const other = overlayStore(ENV, blob.api);
  const race = (patch: Record<string, unknown>) => { blob.hooks.beforePut = async (pathname) => { if (pathname.startsWith(HEAD_PREFIX)) await other.publish(patch, { summary: "Winner", by: "editor" }); else blob.hooks.beforePut = undefined; }; };
  // No head yet: both sides read "no head", the other one commits first.
  blob.hooks.beforePut = async () => { blob.hooks.beforePut = async () => { await other.publish({ "site.footer": "First" }, { summary: "Winner", by: "editor" }); }; };
  await assert.rejects(store.publish({ "site.wordmark": "Loser" }, META), OverlayConflict);
  assert.deepEqual((await store.read()).overlay, { "site.footer": "First" });
  // With a head: the pointer number after the one read at the start is taken.
  blob.hooks.beforePut = async () => { race({ "site.footer": "Second" }); };
  await assert.rejects(store.publish({ "site.wordmark": "Loser" }, META), OverlayConflict);
  const { overlay, head } = await store.read();
  assert.deepEqual(overlay, { "site.footer": "Second" });
  assert.deepEqual(head.history.map((entry) => entry.summary), ["Winner", "Winner"]);
  // An unrelated upload failure is not a conflict.
  blob.hooks.beforePut = async () => { throw new Error("upload failed"); };
  await assert.rejects(store.publish({ "site.wordmark": "Later" }, META), /upload failed/);
});

test("revert points the head at an existing version and refuses anything else", async () => {
  const { blob, store } = setup();
  const a = await store.publish({ "site.wordmark": "A" }, META), b = await store.publish({ "site.wordmark": "B" }, META);
  assert.deepEqual(await store.revert(a.hash), { hash: a.hash, previous: b.hash });
  const { overlay, head } = await store.read();
  assert.deepEqual(overlay, { "site.wordmark": "A" });
  assert.deepEqual(head.history.map(({ hash, by }) => [hash, by]), [[a.hash, "revert"], [b.hash, "editor"], [a.hash, "editor"]]);
  await assert.rejects(store.revert("0123456789abcdef"), OverlayNotFound); // never published
  await assert.rejects(store.revert("../../index"), OverlayNotFound);
  blob.files.set(versionPath("0123456789abcdef"), { text: "{}", etag: "x", uploadedAt: new Date() });
  await assert.rejects(store.revert("0123456789abcdef"), OverlayNotFound); // a file that is not in the history
  blob.files.delete(versionPath(b.hash));
  await assert.rejects(store.revert(b.hash), OverlayNotFound); // in the history, but the file is gone
  assert.equal((await store.read()).head.current, a.hash);
  // null goes back to the code defaults (what `previous: null` of a first publish means).
  const reset = await store.revert(null, { by: "studio:r1" });
  assert.equal(reset.previous, a.hash);
  assert.deepEqual((await store.read()).overlay, {});
  assert.equal(blob.head().history[0].by, "studio:r1");
});

test("a revert that loses a race is a conflict", async () => {
  const { blob, store } = setup();
  const a = await store.publish({ "site.wordmark": "A" }, META);
  await store.publish({ "site.wordmark": "B" }, META);
  blob.hooks.beforePut = async () => { await overlayStore(ENV, blob.api).publish({ "site.wordmark": "C" }, META); };
  await assert.rejects(store.revert(a.hash), OverlayConflict);
  assert.deepEqual((await store.read()).overlay, { "site.wordmark": "C" });
});

test("prune drops entries equal to the code defaults and publishes as a bake", async () => {
  const { blob, store } = setup();
  assert.deepEqual(await store.prune(), []);
  await store.publish({ "site.wordmark": defaults["site.wordmark"], "theme.ink": String(defaults["theme.ink"]).toUpperCase(), "home.links.items": defaults["home.links.items"], "site.footer": "Custom" }, META);
  assert.deepEqual((await store.prune()).sort(), ["home.links.items", "site.wordmark", "theme.ink"]);
  assert.deepEqual((await store.read()).overlay, { "site.footer": "Custom" });
  assert.equal(blob.head().history[0].by, "bake");
  const puts = blob.puts.length;
  assert.deepEqual(await store.prune(), []);
  assert.equal(blob.puts.length, puts);
});

test("history is capped, newest first", async () => {
  const { blob, store } = setup();
  for (let i = 0; i < HISTORY_CAP + 5; i++) await store.publish({ "site.wordmark": `v${i}` }, { summary: `s${i}`, by: "editor" });
  const { history, current } = blob.head();
  assert.equal(history.length, HISTORY_CAP);
  assert.equal(history[0].summary, `s${HISTORY_CAP + 4}`);
  assert.equal(history[0].hash, current);
  assert.equal(history.at(-1)!.summary, "s5");
});

test("without Blob the store reads empty and refuses writes", async () => {
  for (const env of [{}, { BLOB_READ_WRITE_TOKEN: "token", POSTS_SOURCE: "local" }]) {
    const { blob, store } = setup(env);
    assert.deepEqual(await store.read(), { overlay: {}, head: { current: null, history: [] } });
    await assert.rejects(store.publish({ "site.wordmark": "A" }, META), OverlayUnavailable);
    await assert.rejects(store.revert("0123456789abcdef"), OverlayUnavailable);
    await assert.rejects(store.prune(), OverlayUnavailable);
    assert.equal(blob.puts.length, 0);
  }
});

test("the head is never read back from an overwritten file, and old heads are cleaned up", async () => {
  const { blob, store } = setup(), read = overlayReader(ENV, blob.api);
  // The fake serves an overwritten path stale, like the CDN: a publish followed at once by reads must still see itself.
  for (let i = 0; i < POINTERS_KEPT + 4; i++) {
    const { hash } = await store.publish({ "site.wordmark": `v${i}` }, META);
    assert.equal((await store.read()).head.current, hash);
    assert.deepEqual(await read(), { "site.wordmark": `v${i}` });
  }
  assert.equal(new Set(blob.puts).size, blob.puts.length); // no path was ever written twice
  assert.ok(blob.pointers(HEAD_PREFIX).length <= POINTERS_KEPT + 1);
  assert.match(blob.pointers(HEAD_PREFIX)[0], /^site\/overlay\/heads\/\d{12}-[0-9a-f]{16}\.json$/);
});

test("overlayReader: no token and missing head are empty; a read error throws only when there is no last good overlay", async () => {
  const { blob, store } = setup();
  blob.hooks.failGet = true;
  assert.deepEqual(await overlayReader({}, blob.api)(), {}); // no token: Blob is never touched
  await assert.rejects(overlayReader(ENV, blob.api)(), /network down/);
  blob.hooks.failGet = false;
  const read = overlayReader(ENV, blob.api);
  assert.deepEqual(await read(), {}); // nothing published yet
  await store.publish({ "site.wordmark": "Live" }, META);
  assert.deepEqual(await read(), { "site.wordmark": "Live" });
  blob.hooks.status = 500;
  await assert.rejects(overlayReader(ENV, blob.api)(), /Blob read failed/);
  assert.deepEqual(await read(), { "site.wordmark": "Live" }); // this process has a last good overlay: keep rendering it
  blob.hooks.status = undefined;
  blob.plant(HEAD_PREFIX, "{\"current\":\"../x\",\"history\":[]}");
  await assert.rejects(overlayReader(ENV, blob.api)(), /malformed/);
  blob.plant(HEAD_PREFIX, JSON.stringify({ current: "0123456789abcdef", history: [] }));
  await assert.rejects(overlayReader(ENV, blob.api)(), /missing/);
  assert.deepEqual(await read(), { "site.wordmark": "Live" });
});

test("a damaged head or version refuses writes, except going back to the defaults", async () => {
  for (const damage of ["not json", JSON.stringify({ current: "0123456789abcdef", history: [{ hash: "0123456789abcdef", at: "2026-01-01T00:00:00.000Z", summary: "Lost", by: "editor" }] })]) {
    const { blob, store } = setup();
    await store.publish({ "site.wordmark": "A" }, META);
    blob.plant(HEAD_PREFIX, damage);
    await assert.rejects(store.read(), OverlayDamaged);
    await assert.rejects(store.publish({ "site.wordmark": "B" }, META), OverlayDamaged);
    await assert.rejects(store.prune(), OverlayDamaged);
    const reset = await store.revert(null);
    assert.equal(reset.hash, overlayHash({}));
    const { overlay, head } = await store.read();
    assert.deepEqual(overlay, {});
    assert.equal(head.history.length, damage === "not json" ? 1 : 2); // a readable history is kept
    assert.equal((await store.publish({ "site.wordmark": "B" }, META)).previous, reset.hash);
  }
});

// Route handlers.
const URL_BASE = "https://austin.site/api/overlay";
const post = (body: unknown, headers: Record<string, string> = {}) => new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
function routes(env: Record<string, string | undefined> = OWNER) {
  const blob = fakeBlob();
  let revalidated = 0;
  return { blob, handlers: overlayHandlers({ env, blob: blob.api, revalidate: () => { revalidated++; } }), revalidated: () => revalidated };
}
const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const exif = (orientation: number) => seg(0xe1, [...ascii("Exif"), 0, 0, ...ascii("II"), 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0]);
// A minimal 640x480 JPEG: JFIF, optional extra segments, a frame header, and a token scan.
const jpeg = (...extra: number[][]) => new Uint8Array([0xff, 0xd8, ...seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), ...extra.flat(), ...seg(0xc0, [8, 480 >> 8, 480 & 0xff, 640 >> 8, 640 & 0xff, 1, 1, 0x11, 0]), ...seg(0xda, [1, 1, 0, 0, 63, 0]), 9, 9, 0xff, 0xd9]);
function upload(bytes: Uint8Array | null, fields: Record<string, string> = {}, type = "image/jpeg") {
  const form = new FormData();
  if (bytes) form.set("file", new File([bytes as BlobPart], "photo.jpg", { type }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request(`${URL_BASE}/image`, { method: "POST", body: form });
}

test("every overlay route answers 401 without the owner and touches nothing", async () => {
  for (const env of [ENV, { ...ENV, EDITOR_DEV_OWNER: "1", NODE_ENV: "production" }]) {
    const { blob, handlers, revalidated } = routes(env);
    blob.hooks.failGet = true; // would surface as a 500 if a handler read before checking the owner
    const responses = [await handlers.get(new Request(URL_BASE)), await handlers.publish(post({ patch: { "site.wordmark": "X" } })), await handlers.revert(post({ hash: "0123456789abcdef" })), await handlers.image(upload(jpeg()))];
    for (const response of responses) {
      assert.equal(response.status, 401);
      assert.deepEqual(Object.keys(await response.json()), ["error"]);
    }
    assert.equal(blob.puts.length, 0);
    assert.equal(revalidated(), 0);
  }
});

test("GET boots the editor; POST publishes and revalidates; errors map to JSON statuses", async () => {
  const { blob, handlers, revalidated } = routes();
  const boot = await (await handlers.get(new Request(URL_BASE))).json();
  assert.deepEqual([boot.overlay, boot.history, boot.current], [{}, [], null]);
  assert.equal(boot.defaults["site.wordmark"], defaults["site.wordmark"]);
  assert.equal(boot.slots["theme.ink"].kind, "color");

  const published = await handlers.publish(post({ patch: { "site.wordmark": "New" }, summary: "Rename" }));
  assert.equal(published.status, 200);
  const { hash } = await published.json();
  assert.equal(hash, blob.head().current);
  assert.deepEqual([blob.head().history[0].summary, blob.head().history[0].by], ["Rename", "editor"]);
  assert.equal(revalidated(), 1);

  const invalid = await handlers.publish(post({ patch: { "theme.ink": "javascript:alert(1)", "site.wordmark": "ok" } }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(Object.keys((await invalid.json()).slots), ["theme.ink"]);
  assert.equal((await handlers.publish(post({ summary: "no patch" }))).status, 400);
  assert.equal((await handlers.publish(post({ patch: {}, summary: 5 }))).status, 400);
  assert.equal((await handlers.publish(post("{not json"))).status, 400);
  assert.equal((await handlers.publish(post({ patch: {} }, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await handlers.publish(post({ patch: { "home.intro": "x".repeat(600000) } }))).status, 413);
  assert.equal((await handlers.publish(post({ patch: { "site.wordmark": "Evil" } }, { "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal(revalidated(), 1);
  assert.equal(blob.head().current, hash);

  blob.hooks.beforePut = async () => { blob.hooks.beforePut = async () => { await overlayStore(ENV, blob.api).publish({ "site.footer": "Race" }, META); }; };
  assert.equal((await handlers.publish(post({ patch: { "site.wordmark": "Late" } }))).status, 409);

  assert.equal((await handlers.revert(post({ hash: "0123456789abcdef" }))).status, 404);
  assert.equal((await handlers.revert(post({ hash: 7 }))).status, 400);
  const reverted = await handlers.revert(post({ hash }));
  assert.equal(reverted.status, 200);
  assert.equal((await reverted.json()).hash, hash);
  assert.equal(blob.head().current, hash);
  assert.equal(revalidated(), 2);

  blob.hooks.failGet = true;
  const broken = await handlers.get(new Request(URL_BASE));
  assert.equal(broken.status, 500);
  assert.deepEqual(await broken.json(), { error: "Something went wrong." });
});

test("the owner's first boot on a process prunes baked values and revalidates; a damaged head still boots, marked", async () => {
  const { blob, handlers, revalidated } = routes();
  await overlayStore(ENV, blob.api).publish({ "site.wordmark": defaults["site.wordmark"], "site.footer": "Custom" }, META);
  const boot = await (await handlers.get(new Request(URL_BASE))).json();
  assert.deepEqual([boot.overlay, boot.history[0].by, revalidated()], [{ "site.footer": "Custom" }, "bake", 1]);
  await overlayStore(ENV, blob.api).publish({ "site.wordmark": defaults["site.wordmark"] }, META);
  assert.deepEqual(Object.keys((await (await handlers.get(new Request(URL_BASE))).json()).overlay).sort(), ["site.footer", "site.wordmark"]); // once per process
  assert.equal(revalidated(), 1);

  blob.plant(HEAD_PREFIX, "not json");
  const error = console.error;
  console.error = () => {};
  const damaged = await handlers.get(new Request(URL_BASE)), publish = await handlers.publish(post({ patch: { "site.wordmark": "X" } }));
  console.error = error;
  assert.deepEqual([damaged.status, publish.status], [200, 500]);
  assert.deepEqual(await damaged.json().then((body) => [body.damaged, body.overlay, body.current]), [true, {}, null]);
  assert.match((await publish.json()).error, /Back to defaults/);
  assert.equal((await handlers.revert(post({ hash: null }))).status, 200);
  assert.equal((await (await handlers.get(new Request(URL_BASE))).json()).damaged, undefined);
});

test("writes answer 503 when Blob is not configured, while GET still boots with an empty overlay", async () => {
  const { handlers, revalidated } = routes({ NODE_ENV: "test", EDITOR_DEV_OWNER: "1" });
  assert.equal((await handlers.get(new Request(URL_BASE))).status, 200);
  assert.equal((await handlers.publish(post({ patch: { "site.wordmark": "X" } }))).status, 503);
  assert.equal((await handlers.revert(post({ hash: "0123456789abcdef" }))).status, 503);
  assert.equal((await handlers.image(upload(jpeg()))).status, 503);
  assert.equal(revalidated(), 0);
});

test("image upload strips metadata, measures, and refuses what is not an upright JPEG", async () => {
  const { blob, handlers } = routes();
  const ok = await handlers.image(upload(jpeg(exif(1), seg(0xfe, ascii("secret"))), { alt: "A harbor at dusk" }));
  assert.equal(ok.status, 200);
  const image = await ok.json();
  assert.deepEqual({ ...image, url: "" }, { url: "", width: 640, height: 480, alt: "A harbor at dusk" });
  assert.match(image.url, /^https:\/\/store\.public\.blob\.vercel-storage\.com\/site\/images\/[0-9a-f]{16}\.jpg$/);
  assert.equal(blob.files.get(blob.puts[0])!.text, `<${jpeg().length} bytes>`); // EXIF and the comment are gone
  assert.equal((await (await handlers.image(upload(jpeg()))).json()).url, image.url); // content-addressed

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  assert.equal((await handlers.image(upload(png))).status, 415); // the claimed image/jpeg type is ignored
  assert.equal((await handlers.image(upload(new Uint8Array(ascii("<svg onload=alert(1)>")), {}, "image/jpeg"))).status, 415);
  const rotated = await handlers.image(upload(jpeg(exif(6))));
  assert.equal(rotated.status, 400);
  assert.match((await rotated.json()).error, /rotate/i);
  assert.equal((await handlers.image(upload(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])))).status, 400); // no frame to measure
  assert.equal((await handlers.image(upload(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 7, 7])))).status, 400); // malformed
  assert.equal((await handlers.image(upload(jpeg(), { alt: "x".repeat(301) }))).status, 400);
  assert.equal((await handlers.image(upload(null))).status, 400);
  assert.equal((await handlers.image(upload(new Uint8Array(8 * 1024 * 1024 + 1).fill(0xff)))).status, 413);
  assert.equal((await handlers.image(new Request(`${URL_BASE}/image`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status, 400);
  assert.equal(blob.puts.length, 2);
});
