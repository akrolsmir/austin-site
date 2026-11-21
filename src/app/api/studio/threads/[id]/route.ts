import { studio, type IdContext } from "../../live";

// GET: one thread with its messages and runs; `?after=<iso>` returns only what changed since (the polling read).
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const GET = async (request: Request, { params }: IdContext) => studio.thread(request, (await params).id);
