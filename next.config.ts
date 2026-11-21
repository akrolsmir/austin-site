import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` would otherwise append its own rules block to AGENTS.md/CLAUDE.md on every start; the pointer to the bundled docs is kept by hand there.
  agentRules: false,
  images: { remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }] },
};

export default nextConfig;
