import { studio, type IdContext } from "../../../live";

// POST {}: undo what a finished run published (owner only).
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = async (request: Request, { params }: IdContext) => studio.revert(request, (await params).id);
