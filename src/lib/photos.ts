import manifest from "./photos.json";

// Album, newest first. Images live in Vercel Blob (served through the Next optimizer via images.remotePatterns); add one with `bun run photo`.
export type Photo = { url: string; width: number; height: number; date: string; alt: string };
export const photos: Photo[] = manifest;
export const formatMonth = (date: string) => new Date(`${date}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
