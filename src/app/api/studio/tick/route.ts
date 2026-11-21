import { studio } from "../live";

// GET: the studio's scheduler tick (Vercel Cron, vercel.json). It ends runs that died, starts the next queued run, and
// merges a code-lane run whose preview finished, so none of that depends on someone having /studio open.
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const GET = studio.tick;
