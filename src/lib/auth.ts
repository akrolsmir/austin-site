// TODO(auth agent): docs/editable-site.md, "Auth and database". Replace the internals with Better Auth (GitHub sign-in, Drizzle
// adapter over src/db, owner = the session whose linked GitHub account id equals OWNER_GITHUB_ID). Keep these exports and the
// dev-owner rule; getOwner and requireOwner are the only auth API the rest of the code uses.
export type Owner = { id: string; name: string; image?: string };
type Env = Record<string, string | undefined>;
/** A fixed owner for building the UI without OAuth: only outside production, and only when EDITOR_DEV_OWNER=1. */
export const devOwner = (env: Env = process.env): Owner | null => env.NODE_ENV !== "production" && env.EDITOR_DEV_OWNER === "1" ? { id: "dev-owner", name: "Dev owner" } : null;
export async function getOwner(headers: Headers, env: Env = process.env): Promise<Owner | null> {
  void headers; // Stub: no sessions yet, so the dev owner is the only owner there can be.
  return devOwner(env);
}
/** Resolves the owner or throws a 401 Response; every write route calls this first. */
export async function requireOwner(request: Request, env: Env = process.env): Promise<Owner> {
  const owner = await getOwner(request.headers, env);
  if (!owner) throw new Response("Unauthorized", { status: 401 });
  return owner;
}
