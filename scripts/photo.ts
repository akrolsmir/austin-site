// Adds a photo to the album: strips metadata (src/lib/jpeg.ts), uploads to Vercel Blob under photos/<content hash>.jpg,
// and records it in src/lib/photos.json, newest first. Needs BLOB_READ_WRITE_TOKEN in .env.local (Bun loads it).
// Usage: bun run photo <file.jpg> --alt "what the photo shows" [--date YYYY-MM]   (date defaults to the EXIF capture month)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { put } from "@vercel/blob";
import { imageSize } from "image-size";
import { stripJpeg } from "../src/lib/jpeg";
import type { Photo } from "../src/lib/photos";

const MANIFEST = join(process.cwd(), "src", "lib", "photos.json");
const [file, ...rest] = process.argv.slice(2);
const flag = (name: string) => { const i = rest.indexOf(`--${name}`); return i < 0 ? undefined : rest[i + 1]; };
const alt = flag("alt");
if (!file || !alt) throw new Error('Usage: bun run photo <file.jpg> --alt "description" [--date YYYY-MM]');
const { bytes, taken } = stripJpeg(new Uint8Array(readFileSync(file)));
const date = flag("date") ?? taken;
if (!date || !/^\d{4}-\d{2}$/.test(date)) throw new Error("No capture date in EXIF; pass --date YYYY-MM.");
const { width, height } = imageSize(bytes);
const key = `photos/${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.jpg`;
const { url } = await put(key, Buffer.from(bytes), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg" });
const photos = (JSON.parse(readFileSync(MANIFEST, "utf8")) as Photo[]).filter((photo) => photo.url !== url);
photos.push({ url, width, height, date, alt });
photos.sort((a, b) => b.date.localeCompare(a.date));
writeFileSync(MANIFEST, `${JSON.stringify(photos, null, 2)}\n`);
console.log(`Added ${url} (${width}x${height}, ${date}). Commit src/lib/photos.json.`);
