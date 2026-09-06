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
