"use client";

import { useEffect } from "react";

// The only editor code visitors download: it fetches the editor bundle when the owner hint cookie is present (the cookie grants nothing).
export function EditorLoader() {
  useEffect(() => { if (/(?:^|;\s*)editor=1(?:;|$)/.test(document.cookie)) void import("@/editor").then((editor) => editor.mount()); }, []);
  return null;
}
