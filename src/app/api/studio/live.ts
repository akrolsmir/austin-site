import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { studioHandlers } from "./handlers";

// The studio handlers wired to Next: runs execute after the response is sent, and a publish revalidates every page.
export const studio = studioHandlers({ after: (task) => after(task), revalidate: () => revalidatePath("/", "layout") });
export type IdContext = { params: Promise<{ id: string }> };
