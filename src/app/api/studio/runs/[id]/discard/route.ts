import { studio, type IdContext } from "../../../live";

// POST {}: turn down a run waiting at needs_publish, closing its pull request (owner only).
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const POST = async (request: Request, { params }: IdContext) => studio.discard(request, (await params).id);
