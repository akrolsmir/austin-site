import type { Overlay } from "../site/schema";

// TODO(overlay agent): replace this stub with the Blob-backed store from docs/editable-site.md, "Overlay" (overlayStore with
// read/publish/revert/prune, and readPublishedOverlay reading head.json from origin). Keep the exported names below.
export type Head = { current: string | null; history: Array<{ hash: string; at: string; summary: string; by: string }> };
export class OverlayError extends Error {
  constructor(public errors: Record<string, string>) { super(`Invalid overlay: ${Object.keys(errors).join(", ")}`); this.name = "OverlayError"; }
}
export class OverlayConflict extends Error {
  constructor() { super("The overlay changed while publishing."); this.name = "OverlayConflict"; }
}
/** The published overlay for rendering. Stub: always empty, so pages render the code defaults. */
export const readPublishedOverlay = async (): Promise<Overlay> => ({});
export type PublishMeta = { summary: string; by: string };
export type OverlayStore = {
  read(): Promise<{ overlay: Overlay; head: Head }>;
  publish(patch: Record<string, unknown | null>, meta: PublishMeta): Promise<{ hash: string; overlay: Overlay; previous: string | null }>;
  revert(hash: string, meta?: Partial<PublishMeta>): Promise<{ hash: string; previous: string | null }>;
  prune(): Promise<string[]>;
};
/** Stub: the overlay agent implements this (env and blob client injected, as in the contract). */
export function overlayStore(env: Record<string, string | undefined> = process.env): OverlayStore { void env; throw new Error("overlayStore is not implemented yet."); }
