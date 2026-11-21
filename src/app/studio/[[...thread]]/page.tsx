import type { Metadata } from "next";
import { headers } from "next/headers";
import { cache } from "react";
import { dbEnabled, getDb } from "@/db";
import { getOwner } from "@/lib/auth";
import { getThread, listThreads } from "@/lib/studio/store";
import { askAllowed, decodeAsk, type ThreadSummary } from "@/lib/studio/types";
import { routeOf, type Held } from "../logic";
import { Studio, type Initial } from "../studio";
import "../studio.css";

// /studio, /studio/new and /studio/<thread id>: one page, so moving between threads never leaves it. Contract:
// docs/editable-site.md, "Studio". Rendered per request (threads change by the second) with the same viewer filtering as the
// API: a visitor never receives a private thread or message, and a private thread reads exactly like a missing one. The
// client then refreshes from /api/studio and polls while a run is going.
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ thread?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const CURSOR_SLACK_MS = 5000;

const load = cache(async (path: string): Promise<Initial> => {
  const owner = Boolean(await getOwner(await headers())), now = Date.now(), route = routeOf(path);
  const base = { owner, now, threads: [] as ThreadSummary[], held: null as Held | null, missing: route.view === "missing", failed: false };
  if (!dbEnabled()) return { ...base, configured: false };
  try {
    const db = getDb(), who = owner ? "owner" : "public", threads = await listThreads(db, who);
    // A visitor who opens /studio is shown the newest conversation; the owner gets the composer.
    const id = route.view === "thread" ? route.id : route.view === "missing" || owner ? null : threads[0]?.id ?? null;
    const detail = id ? await getThread(db, who, id) : null;
    return { ...base, configured: true, threads, held: detail ? { ...detail, at: new Date(now - CURSOR_SLACK_MS).toISOString() } : null, missing: base.missing || (route.view === "thread" && !detail) };
  } catch (error) {
    console.error(`Studio page failed to load (${error instanceof Error ? error.name : "unknown error"}).`);
    return { ...base, configured: true, failed: true };
  }
});
const pathOf = async (params: Props["params"]) => ["/studio", ...((await params).thread ?? [])].join("/");

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const path = await pathOf(params), initial = await load(path), open = routeOf(path).view === "thread" ? initial.held?.thread : undefined;
  return { title: open && !open.private ? `${open.title} | Studio` : "Studio", description: "Austin talking with his site: requests for changes, and what Claude did about them.", ...(open?.private || initial.missing ? { robots: { index: false, follow: false } } : {}) };
}
export default async function StudioPage({ params, searchParams }: Props) {
  const ask = (await searchParams).ask, initial = await load(await pathOf(params)), param = Array.isArray(ask) ? ask[0] : ask;
  // "Ask Claude about this" context is taken only from the editor's own link (a same-origin navigation), never from a link
  // on another site. The key remounts the studio when a new one arrives while it is already open.
  const context = initial.owner && param && askAllowed(await headers()) ? decodeAsk(param) : null;
  return <Studio key={context ? param : "studio"} initial={initial} ask={context} />;
}
