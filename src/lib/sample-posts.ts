import type { Block, Post } from "./types";

// Titles and IDs transcribed from Austin's public Published view, 2026-09-05.
// Article bodies are deliberately Latin placeholders until Notion is connected.
export const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla cursus, sapien nec posuere bibendum, lacus augue interdum nunc, vitae luctus purus velit vitae ligula.";
export const samplePosts: Post[] = [
  ["3c9a6e41f23e8011acfee1f321dc9ae6", "A guide to working with Austin", "2026-08-27"],
  ["33fa6e41f23e801fa2cdf27d615a099a", "Talk: Starting projects", "2026-04-11"],
  ["282a6e41f23e80aa86fbe9b5a9d4aa12", "How to run your first conference", "2025-10-03"],
  ["24ba6e41f23e806c8efbc72087f8b93d", "What I admire or envy in others", "2025-08-10"],
  ["218a6e41f23e805bb107ed399ee72e07", "On Loyalty", "2025-06-20"],
  ["31178e76a7574911a785749f0cfda423", "Where does the best writing happen?", "2024-09-01"],
].map(([id, title, date]) => ({ id, title, date, edited: date, url: `https://akrolsmir.notion.site/${id}`, excerpt: "" }));

export function sampleBlocks(id: string): Block[] {
  return [0, 1, 2].map((index) => ({ id: `${id}-${index}`, type: "paragraph", paragraph: { rich_text: [{ plain_text: lorem }] } }));
}
