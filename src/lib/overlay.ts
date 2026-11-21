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
