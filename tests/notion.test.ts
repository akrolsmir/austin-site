import { test } from "node:test";
import assert from "node:assert/strict";
import { createNotionClient, publishFilter } from "../src/lib/notion-client";
import { safeUrl } from "../src/lib/types";

const env = { NOTION_TOKEN: "test-only", NOTION_DATA_SOURCE_ID: "source", NOTION_PUBLISH_FILTER: '{"property":"Tags","multi_select":{"does_not_contain":"Draft"}}' };
function post(id: string, date: string, extra = {}) { return { id, object: "page", created_time: "2020-01-01", last_edited_time: "2026-01-01", properties: { Name: { type: "title", title: [{ plain_text: id }] }, Date: { type: "formula", formula: { date: { start: date } } } }, ...extra }; }
const json = (value: unknown) => Response.json(value);

test("publication filters fail closed", () => {
  for (const value of [undefined, "{}", "[]", "null", "true"]) assert.throws(() => publishFilter(value));
  assert.deepEqual(publishFilter(env.NOTION_PUBLISH_FILTER), { property: "Tags", multi_select: { does_not_contain: "Draft" } });
});

test("catalog paginates, sends draft filter, uses formula dates, and removes archived/future pages", async () => {
  let calls = 0;
  const client = createNotionClient(env, (async (_url, init) => {
    const body = JSON.parse(init?.body as string);
    assert.deepEqual(body.filter, publishFilter(env.NOTION_PUBLISH_FILTER));
    calls++;
    if (calls === 1) return json({ results: [post("old", "2022-01-01"), post("future", "2099-01-01"), post("archived", "2024-01-01", { archived: true })], has_more: true, next_cursor: "cursor" });
    assert.equal(body.start_cursor, "cursor");
    return json({ results: [post("new", "2025-01-01")], has_more: false, next_cursor: null });
  }) as typeof fetch);
  const posts = await client.posts();
  assert.deepEqual(posts.map((p) => p.id), ["new", "old"]);
  assert.equal(posts[0].date, "2025-01-01");
  assert.equal(calls, 2);
});

test("nested block pagination preserves order without traversing child pages", async () => {
  const urls: string[] = [];
  const client = createNotionClient(env, (async (input) => {
    const url = String(input); urls.push(url);
    if (url.includes("/root/") && !url.includes("start_cursor")) return json({ results: [{ id: "nested", type: "toggle", has_children: true }], has_more: true, next_cursor: "next" });
    if (url.includes("/nested/")) return json({ results: [{ id: "paragraph", type: "paragraph" }], has_more: false });
    return json({ results: [{ id: "child", type: "child_page", has_children: true }], has_more: false });
  }) as typeof fetch);
  const blocks = await client.blocks("root");
  assert.deepEqual(blocks.map((b) => b.id), ["nested", "child"]);
  assert.equal(blocks[0].children?.[0].id, "paragraph");
  assert.equal(urls.length, 3);
});

test("rate limited requests retry, permanent errors do not become empty results", async () => {
  let count = 0;
  const client = createNotionClient(env, (async () => ++count === 1 ? new Response(null, { status: 429, headers: { "retry-after": "0.001" } }) : json({ results: [], has_more: false })) as typeof fetch);
  assert.deepEqual(await client.posts(), []);
  assert.equal(count, 2);
  const denied = createNotionClient(env, (async () => new Response(null, { status: 403 })) as typeof fetch);
  await assert.rejects(denied.posts(), /403/);
});

test("unsafe link schemes are rejected", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,hello", "file:///etc/passwd", "//evil.example"]) assert.equal(safeUrl(url), undefined);
  assert.equal(safeUrl("https://example.com/article"), "https://example.com/article");
});
