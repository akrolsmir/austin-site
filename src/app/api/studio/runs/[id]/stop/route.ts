import { studio, type IdContext } from "../../../live";

// POST {}: stop a queued or running run (owner only).
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = async (request: Request, { params }: IdContext) => studio.stop(request, (await params).id);
