import { studio, type IdContext } from "../../../live";

// POST {}: approve a run waiting at needs_publish (owner only).
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = async (request: Request, { params }: IdContext) => studio.publish(request, (await params).id);
