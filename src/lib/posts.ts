import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const POSTS_DIR = join(process.cwd(), "data", "posts");
export type PostMeta = { slug: string; title: string; date: string; notion: string; url: string; excerpt: string };
export type PostFile = PostMeta & { body: string };
const FIELDS = ["title", "date", "notion", "url", "excerpt"] as const;

export function slugify(title: string) {
  return title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "") || "untitled";
}
// Frontmatter values are JSON strings, which are valid YAML scalars and round-trip any title.
export function serializePost(post: Omit<PostFile, "slug">) {
  return `---\n${FIELDS.map((key) => `${key}: ${JSON.stringify(post[key])}`).join("\n")}\n---\n\n${post.body}`;
}
export function parsePost(slug: string, raw: string): PostFile {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) throw new Error(`Post ${slug} is missing frontmatter.`);
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const [, key, value] = line.match(/^(\w+): (.*)$/) ?? [];
    if (key) meta[key] = JSON.parse(value);
  }
  for (const key of FIELDS) if (typeof meta[key] !== "string") throw new Error(`Post ${slug} is missing ${key}.`);
  return { slug, title: meta.title, date: meta.date, notion: meta.notion, url: meta.url, excerpt: meta.excerpt, body: raw.slice(match[0].length).trim() };
}

export function readPosts(dir = POSTS_DIR): PostFile[] {
  let files: string[] = [];
  try { files = readdirSync(dir).filter((name) => name.endsWith(".md")); } catch { return []; }
  return files.map((name) => parsePost(name.slice(0, -3), readFileSync(join(dir, name), "utf8"))).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
// "Nov 20, 2026"; dates are calendar days, so format in UTC to avoid shifting a day.
export function formatDate(date: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(date)); }
let cache: PostFile[] | undefined;
export function getPosts() { return (cache ??= readPosts()); }
export function getPost(slug: string) { return getPosts().find((post) => post.slug === slug) ?? null; }
