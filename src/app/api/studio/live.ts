import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { studioHandlers } from "./handlers";

// The studio handlers wired to Next: runs execute after the response is sent, a publish revalidates every page, and a
// visitor's read may be up to two seconds old.
export const studio = studioHandlers({ after: (task) => after(task), revalidate: () => revalidatePath("/", "layout"), cacheMs: 2000 });
export type IdContext = { params: Promise<{ id: string }> };
