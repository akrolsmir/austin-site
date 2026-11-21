import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App, Boundary } from "./app";
import { ROOT_ID, attach, clearDom } from "./dom";
import { getState, load, patch, subscribe, syncDraftFromStorage } from "./store";

// The editor bar (docs/editable-site.md, "Editor bar"). This module is only ever loaded by src/components/editor-loader.tsx
// (dynamic import, owner hint cookie present), so nothing in it reaches visitors.
let root: Root | null = null, host: HTMLElement | null = null, detach: (() => void) | null = null, unsubscribe: (() => void) | null = null;
const onStorage = (event: StorageEvent) => { if (event.key === "site-draft") syncDraftFromStorage(); };
function unmount() {
  detach?.(); unsubscribe?.(); window.removeEventListener("storage", onStorage);
  try { clearDom(); root?.unmount(); } catch { /* already gone */ }
  host?.remove();
  root = host = detach = unsubscribe = null;
}
/** Whatever fails outside React (boot, the DOM layer), the page keeps working and the owner sees one small pill. */
function fail(error: unknown) { console.error("Editor failed to load.", error); detach?.(); detach = null; patch({ phase: "failed" }); }

/** Mounts the editor into its own root at the start of <body> (so the chrome comes first in tab order). Idempotent: React strict mode runs the loader's effect twice. */
export function mount(): void {
  if (host || typeof document === "undefined") return;
  try {
    host = document.createElement("div");
    host.id = ROOT_ID;
    document.body.prepend(host);
    root = createRoot(host);
    root.render(createElement(Boundary, { onClose: unmount }, createElement(App, { onClose: unmount })));
    // A session that is not the owner's takes the editor (and everything it changed on the page) away again.
    unsubscribe = subscribe(() => { if (getState().phase === "gone") unmount(); });
    window.addEventListener("storage", onStorage);
    void load(true).then((ready) => { if (ready && host && !detach) detach = attach(); }).catch(fail);
  } catch (error) { fail(error); }
}
