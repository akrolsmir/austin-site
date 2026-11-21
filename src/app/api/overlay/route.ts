import { revalidatePath } from "next/cache";
import { overlayHandlers } from "./handlers";

// GET: the editor's boot data (owner only). POST { patch, summary }: publish slot values, live once the layout revalidates.
export const dynamic = "force-dynamic";
const handlers = overlayHandlers({ revalidate: () => revalidatePath("/", "layout") });
export const GET = handlers.get;
export const POST = handlers.publish;
