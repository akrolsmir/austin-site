// `bun run sync` mirrors published Notion posts into the committed snapshot (data/posts-raw/<id>.json and
// data/posts/<slug>.md), refetching only posts whose last-edited time changed. `--offline` reconverts from the raw cache
// without touching Notion. `--blob` then pushes the snapshot to the live Blob store (the same core /api/sync runs), which
// is how to seed the store with a cold sync or publish immediately from a laptop.
import { createNotionClient } from "../src/lib/notion-client";
import { blobStore, fsStore, localSource, syncPosts } from "../src/lib/sync";

async function main() {
  const offline = process.argv.includes("--offline");
  await syncPosts({ store: fsStore(), source: offline ? localSource() : createNotionClient() });
  if (process.argv.includes("--blob")) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is missing.");
    console.log("pushing snapshot to Blob");
    // Unchanged posts are reconverted from the local raw cache rather than downloaded from Blob.
    const snapshot = fsStore();
    await syncPosts({ store: { ...blobStore(), readRaw: (entry) => snapshot.readRaw(entry) }, source: localSource() });
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
