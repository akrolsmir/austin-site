import { dbEnabled, getDb } from "../../../../db";
import { runnerEvent } from "../../../../lib/studio/code";

// POST: events from a code-lane runner in its sandbox (step, log, heartbeat, finish), authenticated only by that run's
// bearer token (src/lib/studio/code.ts). The finish event does the GitHub work in this request, hence the long limit.
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = async (request: Request) => {
  if (!dbEnabled()) return Response.json({ error: "Not allowed." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  let origin: string | undefined;
  try { origin = new URL(process.env.BETTER_AUTH_URL || request.url).origin; } catch { origin = new URL(request.url).origin; }
  return runnerEvent({ db: getDb(), origin }, request);
};
