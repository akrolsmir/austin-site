import { revalidatePath } from "next/cache";
import { overlayHandlers } from "../handlers";

// POST { hash }: point the site back at an earlier published version (owner only).
export const dynamic = "force-dynamic";
export const POST = overlayHandlers({ revalidate: () => revalidatePath("/", "layout") }).revert;
