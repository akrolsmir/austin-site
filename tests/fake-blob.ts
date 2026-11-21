import { BlobPreconditionFailedError } from "@vercel/blob";
import type { Head, OverlayBlob } from "../src/lib/overlay";
import { HEAD_PREFIX } from "../src/lib/overlay";
import type { BlobApi } from "../src/lib/sync";

// In-memory stand-in for @vercel/blob shared by the tests. It enforces allowOverwrite and ifMatch like the real service,
// and it reads like the real CDN at its worst: `get` of a path that was overwritten keeps answering with the content it
// had first, so code that overwrites a file and reads it back fails here. `list` always tells the truth.
export function fakeBlob() {
  const files = new Map<string, { text: string; etag: string; uploadedAt: Date }>(), cdn = new Map<string, string>();
  const puts: string[] = [];
  const hooks: { beforePut?: (pathname: string) => Promise<void>; failGet?: boolean; status?: number; failPut?: string } = {};
  let version = 0;
  const url = (pathname: string) => `https://store.public.blob.vercel-storage.com/${pathname}`;
  const api = {
    async get(pathname: string) {
      if (hooks.failGet) throw new Error("network down");
      const file = files.get(pathname);
      if (file && !cdn.has(pathname)) cdn.set(pathname, file.text);
      return file ? { statusCode: hooks.status ?? 200, stream: new Response(cdn.get(pathname)).body, blob: { etag: file.etag } } : null;
    },
    async put(pathname: string, body: string | Buffer, options: { allowOverwrite?: boolean; ifMatch?: string }) {
      if (hooks.failPut && pathname.startsWith(hooks.failPut)) throw new Error("upload failed");
      const hook = hooks.beforePut; hooks.beforePut = undefined;
      await hook?.(pathname);
      const existing = files.get(pathname);
      if (existing && !options.allowOverwrite) throw new Error("This blob already exists");
      if (options.ifMatch && existing?.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
      files.set(pathname, { text: typeof body === "string" ? body : `<${body.length} bytes>`, etag: `e${++version}`, uploadedAt: new Date() });
      puts.push(pathname);
      return { url: url(pathname), pathname };
    },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      if (hooks.failGet) throw new Error("network down");
      return { blobs: [...files].filter(([pathname]) => pathname.startsWith(prefix)).map(([pathname, file]) => ({ pathname, url: url(pathname), uploadedAt: file.uploadedAt })), hasMore: false };
    },
    async del(urls: string | string[]) { for (const one of [urls].flat()) { const pathname = one.replace(url(""), ""); files.delete(pathname); cdn.delete(pathname); } },
  };
  /** Pathnames under a pointer prefix, newest first. */
  const pointers = (prefix: string) => [...files.keys()].filter((pathname) => pathname.startsWith(prefix)).sort().reverse();
  /** The newest pointer's text, or undefined. */
  const pointer = (prefix: string) => files.get(pointers(prefix)[0] ?? "")?.text;
  /** Writes a pointer by hand, one past the newest (to plant a damaged or foreign commit). */
  const plant = (prefix: string, text: string) => { const seq = Number(pointers(prefix)[0]?.slice(prefix.length, prefix.length + 12) ?? 0) + 1; files.set(`${prefix}${String(seq).padStart(12, "0")}-${"0".repeat(16)}.json`, { text, etag: `e${++version}`, uploadedAt: new Date() }); };
  return { api: api as unknown as OverlayBlob & BlobApi, files, puts, hooks, pointers, pointer, plant, head: (): Head => JSON.parse(pointer(HEAD_PREFIX)!) };
}
