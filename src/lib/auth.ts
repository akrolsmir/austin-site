import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq } from "drizzle-orm";
import { dbEnabled, getDb, previewDeployment, schema, type Db } from "@/db";
import { unreviewedPreview } from "./types";

// Contract: docs/editable-site.md, "Auth and database". Better Auth with GitHub as the only way in; the owner is the one session
// whose linked GitHub account id equals OWNER_GITHUB_ID. getOwner and requireOwner are the only auth API the rest of the code
// uses. Nothing here runs at import time: the auth instance is built on first use, and only when all four env vars are set.
export type Owner = { id: string; name: string; image?: string };
export type Viewer = { owner: Owner | null; user: { name: string; image?: string } | null };
type Env = Record<string, string | undefined>;
type SessionUser = { id: string; name: string; image?: string | null };
/** What the owner decision needs to know, injected so tests can fake it. */
export type Lookups = { user(headers: Headers): Promise<SessionUser | null>; githubIds(userId: string): Promise<string[]> };

const MONTH = 60 * 60 * 24 * 30;
/** The hint cookie outlives the session's 30 days (an active session keeps renewing; a 401 from the editor's boot clears the hint). */
export const HINT_MAX_AGE = MONTH * 13;
/** Sign-in needs the database, the signing secret, and the GitHub OAuth app; it is always off on a Vercel preview deployment, whose URL the OAuth app would refuse. */
export const authEnabled = (env: Env = process.env) => Boolean(dbEnabled(env) && !previewDeployment(env) && env.BETTER_AUTH_SECRET && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
export const ownerGithubId = (env: Env = process.env) => env.OWNER_GITHUB_ID?.trim() || "856034";
/** A fixed owner without OAuth: locally with EDITOR_DEV_OWNER=1 (never when NODE_ENV=production), and on a Vercel preview with
 *  EDITOR_PREVIEW_OWNER=1, where everyone who can open the preview is the owner. That is only as private as the project's
 *  Deployment Protection, and it works on preview data only (previewData). Never on production or on a studio branch's preview. */
export const devOwner = (env: Env = process.env): Owner | null => {
  if (env.VERCEL_ENV === "preview" && env.EDITOR_PREVIEW_OWNER === "1" && !unreviewedPreview(env)) return { id: "preview-owner", name: "Preview owner" };
  return env.NODE_ENV !== "production" && env.EDITOR_DEV_OWNER === "1" ? { id: "dev-owner", name: "Dev owner" } : null;
};

/** The Better Auth instance over a given database. Email sign-in stays off (the default) and accounts are never linked together. */
export const createAuth = (db: Db, env: Env = process.env) => betterAuth({
  baseURL: env.BETTER_AUTH_URL || undefined, secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  socialProviders: { github: { clientId: env.GITHUB_CLIENT_ID ?? "", clientSecret: env.GITHUB_CLIENT_SECRET ?? "" } },
  account: { accountLinking: { enabled: false } }, session: { expiresIn: MONTH }, telemetry: { enabled: false },
});
let auth: ReturnType<typeof createAuth> | undefined;
/** The lazily built instance, or null when sign-in isn't configured on this deployment. */
export const getAuth = (env: Env = process.env) => authEnabled(env) ? (auth ??= createAuth(getDb(env), env)) : null;
export const authLookups = (instance: ReturnType<typeof createAuth>, db: Db): Lookups => ({
  user: async (headers) => (await instance.api.getSession({ headers }))?.user ?? null,
  githubIds: async (userId) => (await db.select({ id: schema.account.accountId }).from(schema.account).where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "github")))).map((row) => row.id),
});
/** The pure decision: who is signed in, and are they the owner? Owner only when a GitHub account linked to the session's user has exactly the owner's id. */
export async function viewerFrom(lookups: Lookups, headers: Headers, env: Env = process.env): Promise<Viewer> {
  const user = await lookups.user(headers);
  if (!user?.id) return { owner: null, user: null };
  const shown = { name: user.name, ...(user.image ? { image: user.image } : {}) }, wanted = ownerGithubId(env);
  return { owner: (await lookups.githubIds(user.id)).some((id) => String(id) === wanted) ? { id: user.id, ...shown } : null, user: shown };
}
/** Who is looking at the page (the sign-in page needs "signed in, but not the owner"). Any failure reads as signed out: fail closed. */
export async function getViewer(headers: Headers, env: Env = process.env, lookups?: Lookups): Promise<Viewer> {
  const dev = devOwner(env);
  if (dev) return { owner: dev, user: null };
  if (!authEnabled(env)) return { owner: null, user: null };
  try { return await viewerFrom(lookups ?? authLookups(getAuth(env)!, getDb(env)), headers, env); }
  catch (error) { console.error(`Owner check failed (${error instanceof Error ? error.name : "unknown error"}).`); return { owner: null, user: null }; }
}
export const getOwner = async (headers: Headers, env: Env = process.env): Promise<Owner | null> => (await getViewer(headers, env)).owner;
/** Resolves the owner or throws a 401 Response; every write route calls this first. */
export async function requireOwner(request: Request, env: Env = process.env): Promise<Owner> {
  const owner = await getOwner(request.headers, env);
  if (!owner) throw new Response("Unauthorized", { status: 401 });
  return owner;
}
/** The GET /api/me response: the owner (or null), never cached, setting or clearing the `editor=1` hint cookie. The hint grants nothing. */
export function meResponse(owner: Owner | null, secure = false): Response {
  const cookie = `editor=${owner ? "1" : ""}; Path=/; Max-Age=${owner ? HINT_MAX_AGE : 0}; SameSite=Lax${secure ? "; Secure" : ""}`;
  return Response.json({ owner }, { headers: { "Cache-Control": "private, no-store", "Set-Cookie": cookie } });
}
/** Where to go after sign-in: `next` when it is a path on this site, else "/". */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !/^\/(?![/\\])/.test(next) || /[\u0000-\u001f\\]/.test(next)) return "/";
  try { const url = new URL(next, "http://site.invalid"); return url.origin === "http://site.invalid" ? url.pathname + url.search + url.hash : "/"; } catch { return "/"; }
}
