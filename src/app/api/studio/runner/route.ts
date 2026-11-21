import { studio } from "../live";

// POST: events from a code-lane runner in its sandbox (step, log, heartbeat, finish), authenticated only by that run's
// bearer token (src/lib/studio/code.ts). The finish event does the GitHub work in this request, hence the long limit.
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = studio.runner;
