import { createHash } from "node:crypto";
import { del, put } from "@vercel/blob";
import { defaults, slots, validateValue, type Overlay } from "../site/schema";
import { previewData } from "./types";
import { PointerConflict, blobEnabled, blobReads, readBlob, readPointer, writePointer, type BlobGet, type BlobReads } from "./posts";

// The published slot values (docs/editable-site.md, "Overlay"). Each version is an immutable, content-addressed file
// (site/overlay/<hash>.json). The head (which version is live, plus the history) is the single commit point: a pointer
// under site/overlay/heads/ (readPointer in posts.ts), written as number n+1 only if n is still the newest, so two
// publishes can never silently overwrite each other and a read right after a publish sees it.
// Previews and local dev publish to their own folder, so trying the editor there never changes the live site.
const ROOT = previewData() ? "site/overlay-preview/" : "site/overlay/";
export const HEAD_PREFIX = `${ROOT}heads/`;
export const HISTORY_CAP = 200;
export const versionPath = (hash: string) => `${ROOT}${hash}.json`;
export type HeadEntry = { hash: string; at: string; summary: string; by: string };
export type Head = { current: string | null; history: HeadEntry[] };
export class OverlayError extends Error {
  constructor(public errors: Record<string, string>) { super(`Invalid overlay: ${Object.keys(errors).join(", ")}`); this.name = "OverlayError"; }
}
export class OverlayConflict extends Error {
  constructor() { super("The overlay changed while publishing."); this.name = "OverlayConflict"; }
}
/** A revert target that is not a published version. */
export class OverlayNotFound extends Error {
  constructor() { super("That version does not exist."); this.name = "OverlayNotFound"; }
}
/** The head or the live version cannot be parsed or is missing. Only `revert(null)` (back to the defaults) gets past it. */
export class OverlayDamaged extends Error {
  constructor(message: string) { super(message); this.name = "OverlayDamaged"; }
}
/** A write was attempted without Blob configured (reads just see an empty overlay). */
export class OverlayUnavailable extends Error {
  constructor() { super("Blob storage is not configured."); this.name = "OverlayUnavailable"; }
}
export type PublishMeta = { summary: string; by: string };
export type OverlayStore = {
  read(): Promise<{ overlay: Overlay; head: Head }>;
  publish(patch: Record<string, unknown | null>, meta: PublishMeta): Promise<{ hash: string; overlay: Overlay; previous: string | null }>;
  /** `null` reverts to the code defaults (the state before the first publish, whose `previous` is null) by publishing an empty overlay. */
  revert(hash: string | null, meta?: Partial<PublishMeta>): Promise<{ hash: string; previous: string | null }>;
  prune(): Promise<string[]>;
};
export type OverlayBlob = BlobReads & { put: typeof put; del: typeof del };
export const defaultBlobClient: OverlayBlob = { ...blobReads, put, del };
type Env = Record<string, string | undefined>;

const HASH = /^[0-9a-f]{16}$/;
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
// Top-level keys are sorted so equal overlays hash equally; nested values keep the order validateValue builds them in.
const canonical = (overlay: Overlay) => JSON.stringify(Object.fromEntries(Object.keys(overlay).sort().map((id) => [id, overlay[id]])));
export const overlayHash = (overlay: Overlay) => createHash("sha256").update(canonical(overlay)).digest("hex").slice(0, 16);
const clean = (value: unknown, max: number, fallback: string) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim().slice(0, max) : "") || fallback;

export function parseHead(text: string): Head {
  const head = JSON.parse(text);
  const entry = (item: HeadEntry) => plain(item) && HASH.test(item.hash) && typeof item.at === "string" && typeof item.summary === "string" && typeof item.by === "string";
  if (!plain(head) || !(head.current === null || HASH.test(head.current as string)) || !Array.isArray(head.history) || !head.history.every(entry)) throw new Error("Overlay head is malformed.");
  return { current: head.current as string | null, history: head.history.map(({ hash, at, summary, by }: HeadEntry) => ({ hash, at, summary, by })) };
}
async function readVersion(blobGet: BlobGet, hash: string): Promise<Overlay | null> {
  const found = await readBlob(blobGet, versionPath(hash));
  if (!found) return null;
  let overlay: unknown;
  try { overlay = JSON.parse(found.text); } catch { /* handled below */ }
  if (!plain(overlay)) throw new OverlayDamaged(`Overlay version ${hash} is malformed.`);
  return overlay;
}
async function loadHead(blob: BlobReads) {
  const found = await readPointer(blob, HEAD_PREFIX);
  let head: Head = { current: null, history: [] };
  if (found) try { head = parseHead(found.text); } catch { throw new OverlayDamaged("Overlay head is malformed."); }
  return { head, seq: found?.seq ?? 0, older: found?.older ?? [] };
}
async function load(blob: BlobReads) {
  const from = await loadHead(blob), overlay = from.head.current ? await readVersion(blob.get, from.head.current) : {};
  if (!overlay) throw new OverlayDamaged(`Overlay version ${from.head.current} is missing.`);
  return { ...from, overlay };
}

export function overlayStore(env: Env = process.env, blob: OverlayBlob = defaultBlobClient, now: () => Date = () => new Date()): OverlayStore {
  const state = async () => { if (!blobEnabled(env)) throw new OverlayUnavailable(); return load(blob); };
  type State = Awaited<ReturnType<typeof state>>;
  // Moves the head to `current` as pointer number seq + 1, which only succeeds while the head read at the start is still
  // the newest (the very first publish included). Losing that race is a conflict; nothing is live until this write lands.
  async function commit(from: State, current: string, meta: PublishMeta) {
    const entry: HeadEntry = { hash: current, at: now().toISOString(), summary: clean(meta.summary, 200, "Edited"), by: clean(meta.by, 80, "editor") };
    const next: Head = { current, history: [entry, ...from.head.history].slice(0, HISTORY_CAP) };
    try { await writePointer(blob, HEAD_PREFIX, from.seq + 1, JSON.stringify(next), env.BLOB_READ_WRITE_TOKEN ?? ""); }
    catch (error) { throw error instanceof PointerConflict ? new OverlayConflict() : error; }
    if (from.older.length) await blob.del(from.older).catch(() => {}); // old heads, once 20 newer ones exist
  }
  async function save(from: State, overlay: Overlay, meta: PublishMeta) {
    const hash = overlayHash(overlay), previous = from.head.current;
    if (hash === previous) return { hash, overlay, previous }; // nothing changed: no new version, no history entry
    await blob.put(versionPath(hash), canonical(overlay), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
    await commit(from, hash, meta);
    return { hash, overlay, previous };
  }
  return {
    async read() {
      if (!blobEnabled(env)) return { overlay: {}, head: { current: null, history: [] } };
      const { overlay, head } = await load(blob);
      return { overlay, head };
    },
    async publish(patch, meta) {
      if (!plain(patch)) throw new OverlayError({ patch: "must be an object of slot values" });
      const from = await state(), overlay: Overlay = { ...from.overlay }, errors: Record<string, string> = {};
      for (const [id, value] of Object.entries(patch)) {
        if (value === null) { delete overlay[id]; continue; } // back to the default (also how a retired slot's entry is cleared)
        const result = Object.hasOwn(slots, id) ? validateValue(slots[id], value) : { ok: false as const, error: "is not a slot" };
        if (result.ok) overlay[id] = result.value; else errors[id] = result.error;
      }
      if (Object.keys(errors).length) throw new OverlayError(errors);
      return save(from, overlay, meta);
    },
    async revert(hash, meta = {}) {
      // Going back to the defaults also works when the head or its version cannot be read: it is the way out of that state.
      const from = await state().catch(async (error) => {
        if (hash !== null || !(error instanceof OverlayDamaged)) throw error;
        const head = await loadHead(blob).catch(async () => ({ head: { current: null, history: [] } as Head, seq: (await readPointer(blob, HEAD_PREFIX))?.seq ?? 0, older: [] as string[] }));
        return { ...head, overlay: {} as Overlay };
      }), previous = from.head.current;
      if (hash === null) return (({ hash, previous }) => ({ hash, previous }))(await save(from, {}, { summary: meta.summary ?? "Reverted to the defaults", by: meta.by ?? "revert" }));
      if (typeof hash !== "string" || !HASH.test(hash) || !from.head.history.some((entry) => entry.hash === hash) || !(await readVersion(blob.get, hash))) throw new OverlayNotFound();
      if (hash !== previous) await commit(from, hash, { summary: meta.summary ?? `Reverted to ${hash}`, by: meta.by ?? "revert" });
      return { hash, previous };
    },
    async prune() {
      const from = await state(), overlay: Overlay = { ...from.overlay }, dropped: string[] = [];
      for (const [id, value] of Object.entries(from.overlay)) {
        if (!Object.hasOwn(slots, id)) continue;
        const stored = validateValue(slots[id], value), base = validateValue(slots[id], defaults[id]);
        if (stored.ok && base.ok && JSON.stringify(stored.value) === JSON.stringify(base.value)) { delete overlay[id]; dropped.push(id); }
      }
      if (dropped.length) await save(from, overlay, { summary: `Baked ${dropped.length} ${dropped.length === 1 ? "value" : "values"} into the code`, by: "bake" });
      return dropped;
    },
  };
}

// Versions are immutable, so the last one read is kept for the process lifetime; only the small head is read per render.
/**
 * A reader of the published overlay for rendering. No Blob token or no head yet: `{}`. When a read fails, the last overlay
 * this process read is used (and the failure logged); with none to fall back on it throws, so the build fails or ISR keeps
 * the previous page. It never falls back to the defaults for a site that has published values.
 */
export function overlayReader(env: Env = process.env, blob: BlobReads = defaultBlobClient) {
  let last: { hash: string | null; overlay: Overlay } | undefined;
  return async function read(): Promise<Overlay> {
    if (!blobEnabled(env)) return {};
    try {
      const found = await readPointer(blob, HEAD_PREFIX), hash = found ? parseHead(found.text).current : null;
      if (last?.hash === hash) return last.overlay;
      const overlay = hash ? await readVersion(blob.get, hash) : {};
      if (!overlay) throw new OverlayDamaged(`Overlay version ${hash} is missing.`);
      last = { hash, overlay };
      return overlay;
    } catch (error) {
      if (!last) throw error;
      console.error(`Overlay read failed (${error instanceof Error ? error.name : "unknown error"}); rendering the last version read.`);
      return last.overlay;
    }
  };
}
export const readPublishedOverlay = overlayReader();
