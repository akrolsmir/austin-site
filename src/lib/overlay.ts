import { createHash } from "node:crypto";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { defaults, slots, validateValue, type Overlay } from "../site/schema";
import { blobEnabled, readBlob, type BlobGet } from "./posts";

// The published slot values (docs/editable-site.md, "Overlay"). Each version is an immutable, content-addressed file
// (site/overlay/<hash>.json); site/overlay/head.json names the live one and is the single commit point, written only if
// it is unchanged since it was read (ifMatch), so two publishes can never silently overwrite each other.
export const HEAD_PATH = "site/overlay/head.json";
export const HISTORY_CAP = 200;
export const versionPath = (hash: string) => `site/overlay/${hash}.json`;
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
export type OverlayBlob = { get: BlobGet; put: typeof put };
export const defaultBlobClient: OverlayBlob = { get, put };
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
  const overlay = JSON.parse(found.text);
  if (!plain(overlay)) throw new Error(`Overlay version ${hash} is malformed.`);
  return overlay;
}
// The head is read from origin (bypassing the CDN) so a read right after a publish sees it; versions are immutable.
async function load(blobGet: BlobGet) {
  const found = await readBlob(blobGet, HEAD_PATH, false);
  const head: Head = found ? parseHead(found.text) : { current: null, history: [] };
  const overlay = head.current ? await readVersion(blobGet, head.current) : {};
  if (!overlay) throw new Error(`Overlay version ${head.current} is missing.`);
  return { head, etag: found?.etag, overlay };
}

export function overlayStore(env: Env = process.env, blob: OverlayBlob = defaultBlobClient, now: () => Date = () => new Date()): OverlayStore {
  const state = async () => { if (!blobEnabled(env)) throw new OverlayUnavailable(); return load(blob.get); };
  type State = Awaited<ReturnType<typeof state>>;
  // Moves the head to `current`, only if the head is still the one read at the start. With no head yet the write refuses
  // to overwrite, so the very first publish is conditional too. Any failure after which the head is no longer the one we
  // read is reported as a conflict (Blob has no distinct error for "already exists").
  async function commit(from: State, current: string, meta: PublishMeta) {
    const entry: HeadEntry = { hash: current, at: now().toISOString(), summary: clean(meta.summary, 200, "Edited"), by: clean(meta.by, 80, "editor") };
    const next: Head = { current, history: [entry, ...from.head.history].slice(0, HISTORY_CAP) };
    try {
      await blob.put(HEAD_PATH, JSON.stringify(next), { access: "public", addRandomSuffix: false, allowOverwrite: Boolean(from.etag), ifMatch: from.etag, contentType: "application/json", cacheControlMaxAge: 60 });
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) throw new OverlayConflict();
      const after = await readBlob(blob.get, HEAD_PATH, false).catch(() => undefined);
      if (after !== undefined && after?.etag !== from.etag) throw new OverlayConflict();
      throw error;
    }
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
      const { overlay, head } = await load(blob.get);
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
      const from = await state(), previous = from.head.current;
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
let last: { hash: string; overlay: Overlay } | undefined;
/** The published overlay for rendering. No Blob token or no head yet: `{}`. A Blob read error throws (the build fails or ISR keeps the previous page). */
export async function readPublishedOverlay(env: Env = process.env, blobGet: BlobGet = get): Promise<Overlay> {
  if (!blobEnabled(env)) return {};
  const found = await readBlob(blobGet, HEAD_PATH, false);
  const hash = found ? parseHead(found.text).current : null;
  if (!hash) return {};
  if (last?.hash === hash) return last.overlay;
  const overlay = await readVersion(blobGet, hash);
  if (!overlay) throw new Error(`Overlay version ${hash} is missing.`);
  last = { hash, overlay };
  return overlay;
}
