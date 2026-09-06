import type { ReactNode } from "react";
import { plainText, safeUrl, type Block, type RichText } from "@/lib/types";

export function Rich({ text = [] }: { text?: RichText[] }) {
  return text.map((part, index) => {
    const a = part.annotations;
    let child: ReactNode = part.plain_text ?? part.text?.content ?? "";
    if (a?.code) child = <code>{child}</code>;
    if (a?.bold) child = <strong>{child}</strong>;
    if (a?.italic) child = <em>{child}</em>;
    if (a?.strikethrough) child = <s>{child}</s>;
    if (a?.underline) child = <u>{child}</u>;
    const href = safeUrl(part.href ?? part.text?.link?.url);
    return href ? <a href={href} key={index}>{child}</a> : <span key={index}>{child}</span>;
  });
}
type Payload = { rich_text?: RichText[]; caption?: RichText[]; language?: string; url?: string; type?: string; file?: { url: string }; external?: { url: string }; expression?: string; checked?: boolean; icon?: { emoji?: string }; cells?: RichText[][]; has_column_header?: boolean; title?: string };

export function NotionBlocks({ blocks, sourceUrl }: { blocks: Block[]; sourceUrl: string }) {
  const rendered: ReactNode[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (["bulleted_list_item", "numbered_list_item"].includes(block.type)) {
      const list: Block[] = [block];
      while (blocks[index + 1]?.type === block.type) list.push(blocks[++index]);
      const Tag = block.type === "numbered_list_item" ? "ol" : "ul";
      rendered.push(<Tag key={block.id}>{list.map((item) => <li key={item.id}><Rich text={(item[item.type] as Payload).rich_text} />{item.children && <NotionBlocks blocks={item.children} sourceUrl={sourceUrl} />}</li>)}</Tag>);
    } else rendered.push(<NotionBlock key={block.id} block={block} sourceUrl={sourceUrl} />);
  }
  return rendered;
}
function NotionBlock({ block, sourceUrl }: { block: Block; sourceUrl: string }) {
  const data = (block[block.type] ?? {}) as Payload;
  const text = <Rich text={data.rich_text} />;
  const children = block.children && <NotionBlocks blocks={block.children} sourceUrl={sourceUrl} />;
  const anchor = block.id.replaceAll("-", "");
  switch (block.type) {
    case "paragraph": return <><p id={anchor}>{text}</p>{children}</>;
    case "heading_1": return <><h2 id={anchor}>{text}</h2>{children}</>;
    case "heading_2": return <><h3 id={anchor}>{text}</h3>{children}</>;
    case "heading_3": return <><h4 id={anchor}>{text}</h4>{children}</>;
    case "quote": return <blockquote id={anchor}>{text}{children}</blockquote>;
    case "callout": return <aside className="notion-callout" id={anchor}>{data.icon?.emoji && <span aria-hidden="true">{data.icon.emoji} </span>}{text}{children}</aside>;
    case "toggle": return <details id={anchor}><summary>{text}</summary><div>{children}</div></details>;
    case "to_do": return <div id={anchor}><span aria-label={data.checked ? "Checked" : "Unchecked"}>{data.checked ? "☑" : "☐"}</span> {text}{children}</div>;
    case "code": return <pre id={anchor}><code>{plainText(data.rich_text)}</code></pre>;
    case "divider": return <hr />;
    case "image": {
      const url = safeUrl(data.file?.url ?? data.external?.url);
      if (!url) return null;
      // Notion signed URLs rotate; bodies revalidate every five minutes.
      // eslint-disable-next-line @next/next/no-img-element
      return <figure id={anchor}><img src={url} alt={plainText(data.caption)} loading="lazy" />{data.caption?.length ? <figcaption><Rich text={data.caption} /></figcaption> : null}</figure>;
    }
    case "table": return <div className="table-scroll"><table><tbody>{block.children?.map((row, index) => <tr key={row.id}>{((row.table_row as Payload).cells ?? []).map((cell, col) => data.has_column_header && index === 0 ? <th key={col} scope="col"><Rich text={cell} /></th> : <td key={col}><Rich text={cell} /></td>)}</tr>)}</tbody></table></div>;
    case "column_list": return <div className="notion-columns">{children}</div>;
    case "column": return <div className="notion-column">{children}</div>;
    case "synced_block": if (children) return children; break;
    case "equation": return <pre>{data.expression}</pre>;
    case "bookmark": case "link_preview": case "embed": case "video": case "audio": case "file": case "pdf": {
      const url = safeUrl(data.url ?? data.file?.url ?? data.external?.url);
      return url ? <p><a href={url}>{plainText(data.caption) || url}</a></p> : null;
    }
    case "table_of_contents": return null;
  }
  // Unsupported content remains reachable at its original block rather than disappearing.
  return <p><a href={`${sourceUrl}#${anchor}`}>{data.title || "Notion"}</a></p>;
}
