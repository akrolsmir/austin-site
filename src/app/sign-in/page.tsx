import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { authEnabled, getViewer, safeNext } from "@/lib/auth";
import { SignInActions } from "./actions";
import "./sign-in.css";

// Contract: docs/editable-site.md, "Auth and database". Four quiet states: not set up, signed out, signed in but not the owner, owner.
export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const where = (next: string) => next === "/" ? "Back to the site" : `Back to ${next.split(/[?#]/)[0]}`;

/* eslint-disable @next/next/no-img-element -- a 36px avatar; not worth an image-optimizer remote pattern */
export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams, next = safeNext(one(query.next)), viewer = await getViewer(await headers());
  const enabled = authEnabled() || Boolean(viewer.owner), name = viewer.owner?.name ?? viewer.user?.name ?? "", shown = viewer.owner?.image ?? viewer.user?.image, image = shown?.startsWith("https://") ? shown : undefined;
  const state = !enabled ? "off" : viewer.owner ? "owner" : viewer.user ? "guest" : "out";
  const who = name && <p className="signin-who">{image ? <img src={image} alt="" width={36} height={36} referrerPolicy="no-referrer" /> : <span className="signin-initial" aria-hidden="true">{name.trim().charAt(0).toUpperCase() || "?"}</span>}<span className="signin-name">{name}</span><span className="signin-role">{state === "owner" ? "Owner" : "Not the owner"}</span></p>;
  return <main id="content" className="signin">
    <h1>{state === "owner" ? "You're signed in" : state === "guest" ? "This account can't edit" : "Sign in"}</h1>
    {state === "off" && <><p className="signin-lede">Sign-in isn&apos;t set up on this deployment.</p><p className="signin-foot"><Link href="/">Back to the site</Link></p></>}
    {state === "out" && <><p className="signin-lede">Editing this site is for its owner. Everyone else can read it as it is.</p>{one(query.error) && <p className="signin-note" role="alert">GitHub sign-in didn&apos;t finish. Try again.</p>}</>}
    {state === "guest" && <>{who}<p className="signin-lede">Only the owner&apos;s GitHub account can edit this site. Sign out to use a different account.</p></>}
    {state === "owner" && <>{who}<p className="signin-lede">You can edit the site. The editor bar appears on every page.</p></>}
    {state !== "off" && <SignInActions state={state} next={next} fresh={one(query.done) === "1"} session={Boolean(viewer.user)} back={where(next)} />}
  </main>;
}
