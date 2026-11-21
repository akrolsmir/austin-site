import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import * as schema from "../src/db/schema";
import { dbEnabled, type Db } from "../src/db";
import { authEnabled, authLookups, createAuth, devOwner, getAuth, getOwner, getViewer, meResponse, ownerGithubId, requireOwner, safeNext, viewerFrom, type Lookups } from "../src/lib/auth";

const FULL = { DATABASE_URL: "postgres://user:pw@db.invalid/site", BETTER_AUTH_SECRET: "s".repeat(40), GITHUB_CLIENT_ID: "client-id", GITHUB_CLIENT_SECRET: "client-secret" };
const none = new Headers();

test("authEnabled needs all four of DATABASE_URL, BETTER_AUTH_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET", () => {
  assert.equal(authEnabled(FULL), true);
  assert.equal(authEnabled({}), false);
  // Sign-in is production only (the OAuth callback). The database is on for previews except those of the studio's own branches, which build unapproved code.
  assert.deepEqual([authEnabled({ ...FULL, VERCEL_ENV: "production" }), authEnabled({ ...FULL, VERCEL_ENV: "preview" }), authEnabled({ ...FULL, VERCEL_ENV: "development" })], [true, false, false]);
  assert.deepEqual([dbEnabled({ DATABASE_URL: "x" }), dbEnabled({ DATABASE_URL: "x", VERCEL_ENV: "preview" }), dbEnabled({ DATABASE_URL: "x", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "studio/abc" }), dbEnabled({})], [true, true, false, false]);
  for (const key of Object.keys(FULL)) {
    assert.equal(authEnabled({ ...FULL, [key]: undefined }), false, `without ${key}`);
    assert.equal(authEnabled({ ...FULL, [key]: "" }), false, `empty ${key}`);
  }
  assert.equal(authEnabled({ ...FULL, BETTER_AUTH_URL: undefined, OWNER_GITHUB_ID: undefined }), true);
});

test("with no env there is no owner, no auth instance, and writes get a 401", async () => {
  assert.equal(getAuth({}), null);
  assert.equal(await getOwner(none, {}), null);
  assert.deepEqual(await getViewer(new Headers({ cookie: "better-auth.session_token=forged" }), {}), { owner: null, user: null });
  const thrown = await requireOwner(new Request("https://austin.site/api/overlay", { method: "POST" }), {}).catch((error) => error);
  assert.ok(thrown instanceof Response);
  assert.equal(thrown.status, 401);
});

test("the dev owner exists only outside production and only with EDITOR_DEV_OWNER=1", async () => {
  assert.deepEqual(devOwner({ EDITOR_DEV_OWNER: "1" }), { id: "dev-owner", name: "Dev owner" });
  assert.deepEqual(await getOwner(none, { NODE_ENV: "development", EDITOR_DEV_OWNER: "1" }), { id: "dev-owner", name: "Dev owner" });
  assert.equal((await requireOwner(new Request("https://austin.site/"), { NODE_ENV: "test", EDITOR_DEV_OWNER: "1" })).id, "dev-owner");
  assert.equal(await getOwner(none, { NODE_ENV: "production", EDITOR_DEV_OWNER: "1" }), null);
  for (const value of [undefined, "", "0", "true", "yes"]) assert.equal(await getOwner(none, { NODE_ENV: "development", EDITOR_DEV_OWNER: value }), null);
});

test("the owner decision accepts only a session whose GitHub account id is the owner's", async () => {
  const ada = { id: "u1", name: "Ada", image: "https://avatars.githubusercontent.com/u/856034" };
  const lookups = (user: Awaited<ReturnType<Lookups["user"]>>, ids: string[], seen: string[] = []): Lookups => ({ user: async () => user, githubIds: async (id) => { seen.push(id); return ids; } });
  assert.equal(ownerGithubId({}), "856034");
  assert.equal(ownerGithubId({ OWNER_GITHUB_ID: "" }), "856034");
  assert.deepEqual(await viewerFrom(lookups(ada, ["856034"]), none, {}), { owner: ada, user: { name: "Ada", image: ada.image } });
  assert.deepEqual((await viewerFrom(lookups({ id: "u1", name: "Ada", image: null }, ["856034"]), none, {})).owner, { id: "u1", name: "Ada" });
  // Signed in with some other GitHub account: a known user, but never an owner.
  for (const ids of [["856035"], ["85603"], ["8560340"], [" 856034"], ["0856034"], [""], []]) assert.deepEqual(await viewerFrom(lookups(ada, ids), none, {}), { owner: null, user: { name: "Ada", image: ada.image } }, JSON.stringify(ids));
  // OWNER_GITHUB_ID moves the check, and a number coming back from a driver still compares as a string.
  assert.equal((await viewerFrom(lookups(ada, ["856034"]), none, { OWNER_GITHUB_ID: "42" })).owner, null);
  assert.equal((await viewerFrom(lookups(ada, ["42"]), none, { OWNER_GITHUB_ID: "42" })).owner?.id, "u1");
  assert.equal((await viewerFrom(lookups(ada, [856034 as unknown as string]), none, {})).owner?.id, "u1");
  // No session: nobody, and the account table is never consulted.
  const seen: string[] = [];
  assert.deepEqual(await viewerFrom(lookups(null, ["856034"], seen), none, {}), { owner: null, user: null });
  assert.deepEqual(seen, []);
});

test("a failing lookup reads as signed out rather than throwing", async () => {
  const error = console.error, logged: unknown[] = [];
  console.error = (...args: unknown[]) => { logged.push(...args); };
  const broken: Lookups = { user: async () => { throw new Error(`connect failed for ${FULL.DATABASE_URL}`); }, githubIds: async () => ["856034"] };
  try { assert.deepEqual(await getViewer(none, { ...FULL, NODE_ENV: "production" }, broken), { owner: null, user: null }); }
  finally { console.error = error; }
  assert.equal(logged.length, 1);
  for (const line of logged) for (const secret of Object.values(FULL)) assert.ok(!String(line).includes(secret));
});

test("/api/me sets the editor hint cookie for the owner and clears it otherwise, uncached", async () => {
  const owner = { id: "u1", name: "Ada" }, set = meResponse(owner), cleared = meResponse(null), secure = meResponse(owner, true);
  assert.deepEqual(await set.json(), { owner });
  assert.equal(set.headers.get("set-cookie"), "editor=1; Path=/; Max-Age=33696000; SameSite=Lax");
  assert.deepEqual(await cleared.json(), { owner: null });
  assert.equal(cleared.headers.get("set-cookie"), "editor=; Path=/; Max-Age=0; SameSite=Lax");
  assert.equal(secure.headers.get("set-cookie"), "editor=1; Path=/; Max-Age=33696000; SameSite=Lax; Secure");
  for (const response of [set, cleared]) { assert.match(response.headers.get("cache-control") ?? "", /no-store/); assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /httponly/i); }
});

test("the /api/me route answers no owner and clears the cookie without env", async () => {
  const { GET } = await import("../src/app/api/me/route");
  const response = await GET(new Request("https://austin.site/api/me", { headers: { cookie: "editor=1" } }));
  assert.deepEqual([response.status, await response.json()], [200, { owner: null }]);
  assert.match(response.headers.get("set-cookie") ?? "", /^editor=; Path=\/; Max-Age=0; SameSite=Lax/);
});

test("safeNext keeps same-origin paths and sends everything else home", () => {
  for (const ok of ["/", "/posts", "/posts/a-b?x=1#y", "/studio?ask=%7B%7D"]) assert.equal(safeNext(ok), ok);
  for (const bad of [undefined, null, 7, "", "posts", "https://evil.example/", "//evil.example", "/\\evil.example", "/a\\b", "\\/evil.example", "javascript:alert(1)", "/\tx", "/a\nb", " /posts"]) assert.equal(safeNext(bad), "/", JSON.stringify(bad));
});

// Better Auth end to end over PGlite: the real handler, adapter, and schema, with only GitHub's three HTTP endpoints faked.
test("integration: GitHub sign-in through Better Auth makes an owner only of the owner's GitHub id", async () => {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await (await pushSchema(schema, db as never)).apply();
  const env = { ...FULL, BETTER_AUTH_URL: "http://localhost:3000", NODE_ENV: "test" }, auth = createAuth(db, env), lookups = authLookups(auth, db);
  const realFetch = globalThis.fetch;
  let profile = { id: 0, login: "", name: "", email: "" };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://github.com/login/oauth/access_token")) return Response.json({ access_token: "gho_fake", token_type: "bearer", scope: "read:user,user:email" });
    if (url.startsWith("https://api.github.com/user/emails")) return Response.json([{ email: profile.email, primary: true, verified: true, visibility: "public" }]);
    if (url.startsWith("https://api.github.com/user")) return Response.json({ ...profile, avatar_url: `https://avatars.githubusercontent.com/u/${profile.id}` });
    throw new Error(`unexpected fetch to ${new URL(url).origin}`);
  }) as typeof fetch;
  const jar = (cookies: Map<string, string>, response: Response) => { for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), at = pair.indexOf("="); cookies.set(pair.slice(0, at), pair.slice(at + 1)); } return [...cookies].map(([name, value]) => `${name}=${value}`).join("; "); };
  async function signIn(who: typeof profile) {
    profile = who;
    const cookies = new Map<string, string>(), origin = { origin: "http://localhost:3000" };
    const start = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/social", { method: "POST", headers: { "content-type": "application/json", ...origin }, body: JSON.stringify({ provider: "github", callbackURL: "/sign-in?done=1" }) }));
    const { url } = await start.json() as { url: string }, state = new URL(url).searchParams.get("state");
    assert.equal(new URL(url).origin + new URL(url).pathname, "https://github.com/login/oauth/authorize");
    const back = await auth.handler(new Request(`http://localhost:3000/api/auth/callback/github?code=abc&state=${state}`, { headers: { cookie: jar(cookies, start) } }));
    assert.equal(back.status, 302);
    assert.match(back.headers.get("location") ?? "", /^(http:\/\/localhost:3000)?\/sign-in\?done=1$/);
    return new Headers({ cookie: jar(cookies, back) });
  }
  try {
    const owner = await signIn({ id: 856034, login: "owner", name: "Site Owner", email: "owner@example.com" });
    const viewer = await viewerFrom(lookups, owner, env);
    assert.equal(viewer.owner?.name, "Site Owner");
    assert.equal(viewer.owner?.image, "https://avatars.githubusercontent.com/u/856034");
    const guest = await signIn({ id: 8560340, login: "guest", name: "A Guest", email: "guest@example.com" });
    assert.deepEqual(await viewerFrom(lookups, guest, env), { owner: null, user: { name: "A Guest", image: "https://avatars.githubusercontent.com/u/8560340" } });
    // The same guest becomes the owner only if the deployment says so; a forged or absent cookie is nobody.
    assert.equal((await viewerFrom(lookups, guest, { ...env, OWNER_GITHUB_ID: "8560340" })).owner?.name, "A Guest");
    assert.equal((await viewerFrom(lookups, owner, { ...env, OWNER_GITHUB_ID: "8560340" })).owner, null);
    assert.deepEqual(await viewerFrom(lookups, new Headers({ cookie: "better-auth.session_token=forged.signature" }), env), { owner: null, user: null });
    assert.deepEqual(await viewerFrom(lookups, none, env), { owner: null, user: null });
    // Signing out ends the session server-side: the old cookie stops working.
    const out = await auth.handler(new Request("http://localhost:3000/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: owner.get("cookie")! }, body: "{}" }));
    assert.equal(out.status, 200);
    assert.deepEqual(await viewerFrom(lookups, owner, env), { owner: null, user: null });
  } finally { globalThis.fetch = realFetch; }
});

test("the preview owner exists only on a Vercel preview with EDITOR_PREVIEW_OWNER=1, never on production or a studio branch", async () => {
  const preview = { NODE_ENV: "production", VERCEL_ENV: "preview", EDITOR_PREVIEW_OWNER: "1" };
  assert.deepEqual(await getOwner(none, preview), { id: "preview-owner", name: "Preview owner" });
  for (const env of [{ ...preview, VERCEL_ENV: "production" }, { ...preview, VERCEL_ENV: undefined }, { ...preview, EDITOR_PREVIEW_OWNER: "true" }, { ...preview, VERCEL_GIT_COMMIT_REF: "studio/abc" }, { ...preview, VERCEL_ENV: "production", EDITOR_DEV_OWNER: "1" }]) assert.equal(await getOwner(none, env), null);
});

test("preview data: Vercel previews and next dev, never production or plain scripts", async () => {
  const { previewData } = await import("../src/lib/types");
  assert.deepEqual([{}, { NODE_ENV: "test" }, { NODE_ENV: "production" }, { VERCEL_ENV: "production", NODE_ENV: "production" }, { SITE_DATA: "production", NODE_ENV: "development" }].map(previewData), [false, false, false, false, false]);
  assert.deepEqual([{ NODE_ENV: "development" }, { VERCEL_ENV: "preview", NODE_ENV: "production" }, { VERCEL_ENV: "development" }, { SITE_DATA: "preview" }].map(previewData), [true, true, true, true]);
});
