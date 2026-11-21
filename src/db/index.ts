import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { unreviewedPreview } from "../lib/types";
import * as schema from "./schema";

// docs/editable-site.md, "Auth and database". Data functions take a `Db` so tests can pass a PGlite instance
// (`drizzle(new PGlite(), { schema })` from drizzle-orm/pglite). The neon-http driver has no interactive transactions
// (use db.batch or single statements); swap in the Pool driver here if one becomes necessary.
export { schema };
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
/** A Vercel deployment that is not production. Sign-in is off there (the OAuth app's callback is the production domain); EDITOR_PREVIEW_OWNER stands in. */
export const previewDeployment = (env: Record<string, string | undefined> = process.env) => Boolean(env.VERCEL_ENV) && env.VERCEL_ENV !== "production";
/** Off on previews of the studio's own branches (unreviewed code). Other previews and local dev use the `preview` schema (see schema.ts). */
export const dbEnabled = (env: Record<string, string | undefined> = process.env) => Boolean(env.DATABASE_URL) && !unreviewedPreview(env);
let db: Db | undefined;
/** The lazily created Neon client. Throws when DATABASE_URL is unset: check dbEnabled() first. Never called at import time. */
export function getDb(env: Record<string, string | undefined> = process.env): Db {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  return (db ??= drizzle(neon(env.DATABASE_URL), { schema }));
}
