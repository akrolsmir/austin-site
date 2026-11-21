import { studio } from "../live";

// GET: the threads the viewer may see. POST { body, private?, context? }: start a thread and its first run (owner only).
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const GET = studio.threads;
export const POST = studio.createThread;
