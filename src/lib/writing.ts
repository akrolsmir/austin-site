import "server-only";
import { unstable_cache } from "next/cache";
import { createNotionClient } from "./notion-client";
import { sampleBlocks, samplePosts } from "./sample-posts";

export const WRITING_TAG = "notion-writing-v1";
export const REFRESH_SECONDS = 300;
export const isNotionConfigured = () => Boolean(process.env.NOTION_TOKEN);

function configKey() {
  return [process.env.NOTION_DATABASE_ID, process.env.NOTION_DATA_SOURCE_ID, process.env.NOTION_PUBLISH_FILTER, process.env.NOTION_DATE_PROPERTY, process.env.NOTION_EXCERPT_PROPERTY].join("|");
}

export async function getPosts() {
  if (!isNotionConfigured()) return samplePosts;
  // Throw on upstream failure so Next retains the last successful cache entry.
  return unstable_cache(() => createNotionClient().posts(), ["posts-v1", configKey()], { revalidate: REFRESH_SECONDS, tags: [WRITING_TAG] })();
}

export async function getPost(id: string) {
  // Publication allowlist is checked before any block lookup (including cached bodies).
  const post = (await getPosts()).find((item) => item.id === id);
  if (!post) return null;
  const blocks = !isNotionConfigured() ? sampleBlocks(id) : await unstable_cache(
    () => createNotionClient().blocks(id), ["blocks-v1", configKey(), id, post.edited],
    { revalidate: REFRESH_SECONDS, tags: [WRITING_TAG] },
  )();
  return { ...post, blocks };
}
