import { getOwner, meResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function GET(request: Request) { return meResponse(await getOwner(request.headers), new URL(request.url).protocol === "https:"); }
