import { studio, type IdContext } from "../../../live";

// POST { body, private?, context? }: a follow-up message and its run (owner only).
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = async (request: Request, { params }: IdContext) => studio.postMessage(request, (await params).id);
