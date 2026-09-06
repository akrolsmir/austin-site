"use client";

import { useSyncExternalStore } from "react";
import { defaultStyle, styles, validStyle, type SiteStyle } from "@/lib/styles";

function current() { return validStyle(document.documentElement.dataset.style) ? document.documentElement.dataset.style as SiteStyle : defaultStyle; }
function subscribe(callback: () => void) {
  window.addEventListener("site-style", callback);
  return () => window.removeEventListener("site-style", callback);
}
export function StyleSwitch() {
  const selected = useSyncExternalStore(subscribe, current, () => defaultStyle);
  function change(id: SiteStyle) {
    document.documentElement.setAttribute("data-style", id);
    try { localStorage.setItem("austin-style", id); } catch { /* Storage is optional. */ }
    const url = new URL(window.location.href);
    if (url.searchParams.has("style")) { url.searchParams.set("style", id); window.history.replaceState(null, "", url); }
    window.dispatchEvent(new Event("site-style"));
  }
  return <div className="style-switch" role="group" aria-label="Site style">
    <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="12" r="8"/><path d="M12 4v16M12 4a8 8 0 0 1 0 16" fill="currentColor"/></svg>
    {styles.map((style) => <button key={style.id} type="button" aria-label={style.name} aria-pressed={selected === style.id} onClick={() => change(style.id)}>{style.label}</button>)}
  </div>;
}
