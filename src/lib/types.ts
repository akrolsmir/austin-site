export type RichText = {
  plain_text?: string;
  text?: { content: string; link?: { url: string } | null };
  href?: string | null;
  annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean; code?: boolean; color?: string };
};

export type Block = {
  id: string;
  type: string;
  has_children?: boolean;
  children?: Block[];
  [key: string]: unknown;
};

export type Post = {
  id: string;
  title: string;
  date: string;
  edited: string;
  url: string;
  excerpt: string;
};

export function plainText(value: RichText[] = []) {
  return value.map((part) => part.plain_text ?? part.text?.content ?? "").join("");
}

export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

type Env = Record<string, string | undefined>;
/** Where this process keeps the editable site's data. Only production (and plain scripts) use the live data; Vercel previews
 *  and `next dev` get their own Postgres schema and overlay folder, so trying things there never changes austin.site.
 *  `SITE_DATA=production|preview` overrides (e.g. `SITE_DATA=preview bun run db:push`). */
export const previewData = (env: Env = process.env) => env.SITE_DATA ? env.SITE_DATA !== "production" : env.VERCEL_ENV ? env.VERCEL_ENV !== "production" : env.NODE_ENV === "development";
/** A preview built from one of the studio's own branches: code nobody has approved yet, so the database and owner mode stay off there. */
export const unreviewedPreview = (env: Env = process.env) => Boolean(env.VERCEL_ENV) && env.VERCEL_ENV !== "production" && (env.VERCEL_GIT_COMMIT_REF ?? "").startsWith("studio/");
