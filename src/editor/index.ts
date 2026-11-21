// TODO(editor agent): build the editor bar here per docs/editable-site.md, "Editor bar". This module is only ever loaded by
// src/components/editor-loader.tsx (dynamic import, owner hint cookie present), so nothing in it reaches visitors.
// mount() may be called more than once (React strict mode re-runs the loader's effect); keep it idempotent.
export function mount(): void {}
