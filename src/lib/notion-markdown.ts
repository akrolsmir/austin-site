import { plainText, safeUrl, type Block, type RichText } from "./types";

type Payload = { rich_text?: RichText[]; caption?: RichText[]; language?: string; url?: string; file?: { url: string }; external?: { url: string }; expression?: string; checked?: boolean; icon?: { emoji?: string }; cells?: RichText[][]; has_column_header?: boolean; title?: string };
export type MarkdownOptions = { sourceUrl: string };
export const MEDIA = ["image", "video", "audio", "file", "pdf"];

// Text runs are escaped so committed markdown never carries raw HTML from Notion; only this converter emits tags.
function escapeText(value: string) { return value.replace(/[\\`*_[\]<>~$]/g, "\\$&"); }
export function richText(parts: RichText[] = []) {
  return parts.map((part) => {
    if ((part as { type?: string }).type === "equation") return `$${part.plain_text ?? ""}$`;
    const a = part.annotations;
    const raw = part.plain_text ?? part.text?.content ?? "";
    if (!raw) return "";
    const lead = raw.match(/^\s*/)?.[0] ?? "", trail = raw.match(/\s*$/)?.[0] ?? "";
    let text = raw.slice(lead.length, raw.length - trail.length);
    if (!text) return raw;
    if (a?.code) text = `\`${text.replaceAll("`", "\\`")}\``; else text = escapeText(text);
    if (a?.bold) text = `**${text}**`;
    if (a?.italic) text = `*${text}*`;
    if (a?.strikethrough) text = `~~${text}~~`;
    if (a?.underline) text = `<u>${text}</u>`;
    const href = safeUrl(part.href ?? part.text?.link?.url);
    return `${lead}${href ? `[${text}](${href})` : text}${trail}`;
  }).join("");
}

export function blocksToMarkdown(blocks: Block[], options: MarkdownOptions): string {
  return render(blocks, options).join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
const indent = (text: string, prefix: string) => text.split("\n").map((line, index) => line ? (index ? " ".repeat(prefix.length) : prefix) + line : "").join("\n");
// Nested lists stay tight; other children need a blank line to become their own paragraph.
const joinItem = (parts: string[]) => parts.reduce((acc, part) => acc + (/^(- |\d+\. )/.test(part) ? "\n" : "\n\n") + part);
function render(blocks: Block[], options: MarkdownOptions): string[] {
  const out: string[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (["bulleted_list_item", "numbered_list_item", "to_do"].includes(block.type)) {
      const items: string[] = [];
      for (; blocks[index]?.type === block.type; index++) {
        const item = blocks[index], data = (item[item.type] ?? {}) as Payload;
        const marker = block.type === "numbered_list_item" ? `${items.length + 1}. ` : block.type === "to_do" ? `- [${data.checked ? "x" : " "}] ` : "- ";
        const body = joinItem([richText(data.rich_text), ...(item.children ? render(item.children, options) : [])]);
        items.push(indent(body, marker));
      }
      index--;
      out.push(items.join("\n"));
    } else out.push(...renderBlock(block, options));
  }
  return out.filter(Boolean);
}
function renderBlock(block: Block, options: MarkdownOptions): string[] {
  const data = (block[block.type] ?? {}) as Payload;
  const text = richText(data.rich_text);
  const children = block.children ? render(block.children, options) : [];
  const anchor = block.id.replaceAll("-", "");
  const quote = (lines: string[]) => lines.join("\n\n").split("\n").map((line) => `> ${line}`.trimEnd()).join("\n");
  switch (block.type) {
    case "paragraph": return [text, ...children];
    // The post title is the page's only h1; Notion headings shift down one level.
    case "heading_1": return [`## ${text}`, ...children];
    case "heading_2": return [`### ${text}`, ...children];
    case "heading_3": return [`#### ${text}`, ...children];
    case "quote": return [quote([text, ...children])];
    case "callout": return [quote([`${data.icon?.emoji ? `${data.icon.emoji} ` : ""}${text}`, ...children])];
    case "toggle": return [`**${text}**`, ...children];
    case "code": return [`\`\`\`${data.language ?? ""}\n${plainText(data.rich_text)}\n\`\`\``, ...children];
    case "divider": return ["---"];
    case "equation": return [`$$\n${data.expression ?? ""}\n$$`];
    case "table": {
      const rows = (block.children ?? []).map((row) => ((row.table_row as Payload)?.cells ?? []).map((cell) => richText(cell).replaceAll("|", "\\|").replaceAll("\n", " ")));
      if (!rows.length) return [];
      const width = Math.max(...rows.map((row) => row.length));
      const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
      const header = data.has_column_header ? rows.shift()! : Array.from({ length: width }, () => "");
      return [[line(header), line(Array.from({ length: width }, () => "---")), ...rows.map(line)].join("\n")];
    }
    case "column_list": case "column": case "synced_block": return children;
    case "table_of_contents": case "breadcrumb": return [];
  }
  if (MEDIA.includes(block.type) || ["bookmark", "link_preview", "embed"].includes(block.type)) {
    // Notion-hosted file URLs are already replaced with Blob mirrors by the sync before conversion.
    const url = safeUrl(data.file?.url ?? data.external?.url ?? data.url);
    if (!url) return [];
    const caption = richText(data.caption);
    if (block.type === "image") return [`![${plainText(data.caption).replaceAll("]", "")}](${url})`, ...children];
    return [`[${caption || url}](${url})`, ...children];
  }
  // Unsupported content stays reachable at its original block rather than disappearing.
  return [`[${escapeText(data.title || "View in Notion")}](${options.sourceUrl}#${anchor})`];
}
