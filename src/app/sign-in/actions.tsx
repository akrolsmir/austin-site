"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// The sign-in page's only client code: start GitHub sign-in, sign out, and ask /api/me to set or clear the editor hint cookie.
const post = (path: string, body: unknown) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const me = () => fetch("/api/me", { cache: "no-store" }).catch(() => null);
const GitHubMark = () => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.34c-2.23.49-2.7-1.07-2.7-1.07-.36-.93-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.71 1.23 1.87.87 2.33.67.07-.52.28-.87.5-1.07-1.77-.2-3.64-.89-3.64-3.95 0-.88.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" /></svg>;

export function SignInActions({ state, next, fresh, session, back }: { state: "out" | "guest" | "owner"; next: string; fresh: boolean; session: boolean; back: string }) {
  const [busy, setBusy] = useState<"" | "in" | "out">(""), [error, setError] = useState("");
  const here = `/sign-in?next=${encodeURIComponent(next)}`, leaving = fresh && state === "owner" && next !== "/sign-in";
  // Every visit syncs the hint cookie with the real session; straight after a sign-in the owner goes on to where they were headed.
  useEffect(() => { void me().then(() => { if (leaving) window.location.replace(next); }); }, [leaving, next]);
  async function signIn() {
    setBusy("in"); setError("");
    try {
      const response = await post("/api/auth/sign-in/social", { provider: "github", callbackURL: `${here}&done=1`, errorCallbackURL: `${here}&error=1` }), data = response.ok ? await response.json() : null;
      if (typeof data?.url !== "string") throw new Error("no url");
      window.location.assign(data.url);
    } catch { setBusy(""); setError("Couldn't start GitHub sign-in. Try again."); }
  }
  async function signOut() {
    setBusy("out"); setError("");
    try {
      if (!(await post("/api/auth/sign-out", {})).ok) throw new Error("failed");
      await me();
      window.location.replace(here);
    } catch { setBusy(""); setError("Couldn't sign out. Try again."); }
  }
  return <>
    <div className="signin-actions">
      {state === "out" && <button type="button" className="signin-button" onClick={signIn} disabled={busy !== ""} aria-busy={busy === "in"}><GitHubMark />{busy === "in" ? "Opening GitHub…" : "Continue with GitHub"}</button>}
      {state === "owner" && <Link className="signin-button" href={next}>{leaving ? "Taking you back…" : back}</Link>}
      {session && <button type="button" className={state === "guest" ? "signin-button" : "signin-button signin-quiet"} onClick={signOut} disabled={busy !== ""} aria-busy={busy === "out"}>{busy === "out" ? "Signing out…" : "Sign out"}</button>}
      {state === "guest" && <Link className="signin-link" href="/">Back to the site</Link>}
    </div>
    <p className="signin-note" role="alert">{error}</p>
  </>;
}
