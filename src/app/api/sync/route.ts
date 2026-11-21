import { revalidatePath } from "next/cache";
import { runSync, syncHandler } from "@/lib/sync";

// Publishes Notion changes to Blob and revalidates the affected pages. See authorize() in src/lib/sync.ts for auth.
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const handler = syncHandler({ run: (deadline) => runSync(process.env, deadline), revalidate: (path) => revalidatePath(path) });
export { handler as GET, handler as POST };
