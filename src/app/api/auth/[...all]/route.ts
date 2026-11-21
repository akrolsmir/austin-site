import { getAuth } from "@/lib/auth";

// Better Auth's own endpoints (GitHub sign-in, callback, sign-out). Without auth env the whole surface is a quiet 404.
export const dynamic = "force-dynamic";
const handle = async (request: Request) => getAuth()?.handler(request) ?? Response.json({ error: "Sign-in isn't set up on this deployment." }, { status: 404 });
export { handle as GET, handle as POST };
