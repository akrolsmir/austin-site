import { revalidatePath } from "next/cache";
import { lastSynced, runSync, syncHandler } from "@/lib/sync";

// Publishes Notion changes to Blob and revalidates the affected pages. Open, with a cooldown for calls without CRON_SECRET (see syncHandler in src/lib/sync.ts).
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const handler = syncHandler({ run: (deadline) => runSync(process.env, deadline), lastSync: () => lastSynced(), revalidate: (path, type) => revalidatePath(path, type) });
export { handler as GET, handler as POST };
