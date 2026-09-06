import { test } from "node:test";
import assert from "node:assert/strict";
import { blocksToMarkdown, richText } from "../src/lib/notion-markdown";
import { parsePost, serializePost, slugify } from "../src/lib/posts";
import type { Block } from "../src/lib/types";

const t = (plain_text: string, annotations = {}, href?: string) => ({ plain_text, annotations, href });
const b = (type: string, rich_text: ReturnType<typeof t>[], extra = {}, children?: Block[]): Block => ({ id: `${type}-${rich_text[0]?.plain_text ?? ""}`.replace(/\W/g, ""), type, [type]: { rich_text, ...extra }, children });
const options = { sourceUrl: "https://notion.example/page" };

test("rich text keeps annotations and links, escapes markdown and html", () => {
  assert.equal(richText([t("bold ", { bold: true }), t("x", { italic: true, code: true }), t(" "), t("go", {}, "https://a.example/"), t("<b>*_[")]), "**bold** *`x`* [go](https://a.example/)\\<b\\>\\*\\_\\[");
  assert.equal(richText([t("javascript", {}, "javascript:alert(1)")]), "javascript");
});

test("blocks become readable markdown with shifted headings and tight nested lists", () => {
  const blocks = [
    b("heading_1", [t("Top")]), b("paragraph", [t("Hello")]),
    b("bulleted_list_item", [t("one")], {}, [b("bulleted_list_item", [t("nested")])]), b("bulleted_list_item", [t("two")]),
    b("numbered_list_item", [t("first")]), b("numbered_list_item", [t("second")]),
    b("to_do", [t("done")], { checked: true }), b("quote", [t("wise")]), b("callout", [t("note")], { icon: { emoji: "💡" } }),
    b("code", [t("x = 1")], { language: "python" }), b("divider", []),
    { id: "tbl", type: "table", table: { has_column_header: true }, children: [{ id: "r1", type: "table_row", table_row: { cells: [[t("a|b")], [t("c")]] } }, { id: "r2", type: "table_row", table_row: { cells: [[t("1")], [t("2")]] } }] },
    { id: "img", type: "image", image: { file: { url: "https://blob.example/img.png", width: 1200, height: 800 }, caption: [t("pic")] } },
    { id: "ext", type: "image", image: { external: { url: "https://pics.example/x.png" } } },
    { id: "weird", type: "child_database", child_database: { title: "DB" } },
  ];
  const md = blocksToMarkdown(blocks, options);
  assert.equal(md, `## Top

Hello

- one
  - nested
- two

1. first
2. second

- [x] done

> wise

> 💡 note

\`\`\`python
x = 1
\`\`\`

---

| a\\|b | c |
| --- | --- |
| 1 | 2 |

![pic](https://blob.example/img.png "1200x800")

![](https://pics.example/x.png)

[DB](https://notion.example/page#weird)
`);
});

test("external media keeps its url and columns flatten", () => {
  const blocks = [{ id: "c", type: "column_list", column_list: {}, children: [{ id: "col", type: "column", column: {}, children: [{ id: "ext", type: "image", image: { external: { url: "https://cdn.example/a.jpg" }, caption: [] } }] }] }];
  assert.equal(blocksToMarkdown(blocks, options), "![](https://cdn.example/a.jpg)\n");
});

test("frontmatter round-trips awkward titles and slugs are stable", () => {
  const post = { title: 'Quotes: "yes" & no', date: "2026-01-02", notion: "a".repeat(32), url: "https://n.example/x", excerpt: "line\nbreak", body: "Body\n" };
  const parsed = parsePost("quotes-yes-no", serializePost(post));
  assert.deepEqual(parsed, { slug: "quotes-yes-no", ...post, body: "Body" });
  assert.throws(() => parsePost("x", "no frontmatter"));
  assert.equal(slugify('Quotes: "yes" & no'), "quotes-yes-no");
  assert.equal(slugify("Café über — Ünïcode!"), "cafe-uber-unicode");
  assert.equal(slugify("???"), "untitled");
});
