import { plainText, type Block, type Post, type RichText } from "./types";

type Property = { type: string; title?: RichText[]; rich_text?: RichText[]; date?: { start: string } | null; formula?: { date?: { start: string } | null } };
type Page = { id: string; object: string; archived?: boolean; in_trash?: boolean; created_time: string; last_edited_time: string; url: string; public_url?: string | null; properties: Record<string, Property> };
type List<T> = { results: T[]; has_more: boolean; next_cursor: string | null; request_status?: { type: string } };
const API = "https://api.notion.com/v1";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function publishFilter(raw: string | undefined): Record<string, unknown> {
  if (!raw) throw new Error("NOTION_PUBLISH_FILTER is required; refusing to query unfiltered writing.");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !["property", "and", "or"].some((key) => key in parsed)) {
    throw new Error("NOTION_PUBLISH_FILTER must be a Notion property or compound filter.");
  }
  return parsed;
}

export function createNotionClient(env: Record<string, string | undefined> = process.env, request: typeof fetch = fetch) {
  if (!env.NOTION_TOKEN) throw new Error("NOTION_TOKEN is missing.");
  // Serial calls within each client avoid block-tree fan-out and respect rate limits.
  let lastRequest = 0;
  async function api<T>(path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(Math.max(0, 350 - (Date.now() - lastRequest)));
      lastRequest = Date.now();
      const response = await request(`${API}${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, "Notion-Version": "2026-03-11", "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      if (response.ok) return await response.json() as T;
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retry = Number(response.headers.get("retry-after"));
        await sleep(Math.min(10000, Number.isFinite(retry) && retry > 0 ? retry * 1000 : 500 * 2 ** attempt));
        continue;
      }
      // Do not log response bodies, request headers, or tokens.
      throw new Error(`Notion request failed (${response.status}). Check connection access and schema.`);
    }
    throw new Error("Notion retry limit reached.");
  }

  async function dataSourceId() {
    if (env.NOTION_DATA_SOURCE_ID) return env.NOTION_DATA_SOURCE_ID;
    if (!env.NOTION_DATABASE_ID) throw new Error("NOTION_DATABASE_ID or NOTION_DATA_SOURCE_ID is required.");
    const db = await api<{ data_sources: { id: string }[] }>(`/databases/${env.NOTION_DATABASE_ID}`);
    if (db.data_sources.length !== 1) throw new Error("Set NOTION_DATA_SOURCE_ID explicitly for a database with multiple data sources.");
    return db.data_sources[0].id;
  }

  async function posts(): Promise<Post[]> {
    const filter = publishFilter(env.NOTION_PUBLISH_FILTER);
    const source = await dataSourceId();
    const result: Post[] = [];
    let cursor: string | null = null;
    do {
      const page: List<Page> = await api(`/data_sources/${source}/query`, { filter, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      if (page.request_status?.type === "incomplete") throw new Error("Notion returned a truncated query; refusing a partial writing index.");
      for (const item of page.results) {
        if (item.object !== "page" || item.archived || item.in_trash) continue;
        const title = plainText(Object.values(item.properties).find((p) => p.type === "title")?.title);
        if (!title) continue;
        const dateProperty = item.properties[env.NOTION_DATE_PROPERTY ?? "Date"];
        const date = dateProperty?.date?.start ?? dateProperty?.formula?.date?.start ?? item.created_time;
        // Future-dated posts are never included, even if their status is Published.
        if (new Date(date).getTime() > Date.now()) continue;
        result.push({ id: item.id.replaceAll("-", ""), title, date, edited: item.last_edited_time, url: item.public_url || `https://akrolsmir.notion.site/${item.id.replaceAll("-", "")}`, excerpt: plainText(item.properties[env.NOTION_EXCERPT_PROPERTY ?? "Excerpt"]?.rich_text) });
      }
      if (page.has_more && !page.next_cursor) throw new Error("Notion pagination cursor missing.");
      cursor = page.has_more ? page.next_cursor : null;
    } while (cursor);
    return result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  async function blocks(id: string, depth = 0): Promise<Block[]> {
    if (depth > 20) throw new Error("Notion block nesting exceeds 20 levels.");
    const all: Block[] = [];
    let cursor: string | null = null;
    do {
      const page: List<Block> = await api(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
      for (const block of page.results) {
        // Child pages/databases are separate documents; never traverse them implicitly.
        if (block.has_children && !["child_page", "child_database"].includes(block.type)) {
          block.children = await blocks(block.id, depth + 1);
        }
        all.push(block);
      }
      if (page.has_more && !page.next_cursor) throw new Error("Notion block pagination cursor missing.");
      cursor = page.has_more ? page.next_cursor : null;
    } while (cursor);
    return all;
  }
  return { posts, blocks };
}
