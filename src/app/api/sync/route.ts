import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { createNotionClient } from "@/lib/notion-client";
import { WRITING_TAG } from "@/lib/writing";

export const maxDuration = 120;
export const dynamic = "force-dynamic";
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function sync(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    // Validate the full index first. Never invalidate a healthy cache after an upstream failure.
    const posts = await createNotionClient().posts();
    revalidateTag(WRITING_TAG, "max");
    // Warm the homepage to trigger ISR even when the site has no visitors.
    const origin = process.env.SITE_URL;
    let warmed = false;
    if (origin) {
      const response = await fetch(new URL("/", origin), { cache: "no-store", signal: AbortSignal.timeout(30000) });
      await response.text();
      warmed = response.ok;
    }
    return Response.json({ ok: true, posts: posts.length, warmed, refreshedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Writing sync failed:", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Writing sync failed; cache was retained where possible." }, { status: 503 });
  }
}
export const GET = sync;
export const POST = sync;
