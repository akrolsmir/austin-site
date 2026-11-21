import { createHash } from "node:crypto";
import { imageSize } from "image-size";
import { requireOwner } from "../../../lib/auth";
import { stripJpeg } from "../../../lib/jpeg";
import { OverlayConflict, OverlayError, OverlayNotFound, OverlayUnavailable, defaultBlobClient, overlayStore, type OverlayBlob } from "../../../lib/overlay";
import { blobEnabled } from "../../../lib/posts";
import { defaults, slots, validateValue, type ImageValue } from "../../../site/schema";

// The overlay routes' logic, with env, Blob, auth, and revalidation injected so tests run it against an in-memory fake.
// Every handler resolves the owner before anything else (reads included) and answers in JSON.
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BYTES = 512 * 1024;
type Deps = { env?: Record<string, string | undefined>; blob?: OverlayBlob; owner?: (request: Request) => Promise<unknown>; revalidate?: () => void };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);
class Refused extends Error { constructor(public status: number, message: string) { super(message); } }
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
async function body(request: Request) {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) throw new Refused(415, "Send JSON.");
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new Refused(413, "That request is too large.");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Refused(400, "That request is not valid JSON."); }
  if (!plain(parsed)) throw new Refused(400, "That request is not a JSON object.");
  return parsed;
}
// Browsers label where a request came from; a write from another site is refused even if it somehow carried the session.
const sameSite = (request: Request) => ["same-origin", "none", null].includes(request.headers.get("sec-fetch-site"));

export function overlayHandlers({ env = process.env, blob = defaultBlobClient, owner = (request) => requireOwner(request, env), revalidate = () => {} }: Deps = {}) {
  const store = () => overlayStore(env, blob);
  const guard = (write: boolean, run: (request: Request) => Promise<Response>) => async (request: Request) => {
    try {
      await owner(request);
      if (write && !sameSite(request)) return fail(403, "Cross-site requests are not allowed.");
      return await run(request);
    } catch (error) {
      if (error instanceof Response) return fail(error.status, error.status === 401 ? "Sign in as the owner." : "Not allowed.");
      if (error instanceof Refused) return fail(error.status, error.message);
      if (error instanceof OverlayError) return fail(400, "Some values were not accepted.", { slots: error.errors });
      if (error instanceof OverlayConflict) return fail(409, "The site changed while publishing. Reload and try again.");
      if (error instanceof OverlayNotFound) return fail(404, error.message);
      if (error instanceof OverlayUnavailable) return fail(503, error.message);
      console.error(`Overlay request failed: ${error instanceof Error ? `${error.name}: ${error.message}` : "unknown error"}`);
      return fail(500, "Something went wrong.");
    }
  };
  return {
    get: guard(false, async () => {
      const { overlay, head } = await store().read();
      return json({ overlay, current: head.current, history: head.history, defaults, slots });
    }),
    publish: guard(true, async (request) => {
      const { patch, summary } = await body(request);
      if (!plain(patch)) throw new OverlayError({ patch: "must be an object of slot values" });
      if (summary !== undefined && (typeof summary !== "string" || summary.length > 200)) throw new Refused(400, "The summary must be text of at most 200 characters.");
      const count = Object.keys(patch).length;
      const { hash, previous } = await store().publish(patch, { summary: summary || `Edited ${count} ${count === 1 ? "value" : "values"}`, by: "editor" });
      revalidate();
      return json({ hash, previous });
    }),
    revert: guard(true, async (request) => {
      const { hash } = await body(request);
      if (hash !== null && typeof hash !== "string") throw new Refused(400, "Name the version to revert to.");
      const result = await store().revert(hash);
      revalidate();
      return json(result);
    }),
    image: guard(true, async (request) => {
      if (!blobEnabled(env)) throw new OverlayUnavailable();
      if (Number(request.headers.get("content-length")) > MAX_IMAGE_BYTES + 65536) throw new Refused(413, "Images can be at most 8 MB.");
      const form = await request.formData().catch(() => { throw new Refused(400, "Send the image as a multipart form."); });
      const file = form.get("file"), alt = form.get("alt") ?? "";
      if (!(file instanceof Blob) || !file.size) throw new Refused(400, "No image was sent.");
      if (file.size > MAX_IMAGE_BYTES) throw new Refused(413, "Images can be at most 8 MB.");
      const checked = validateValue({ kind: "text", label: "Alt text", group: "", max: 300 }, alt);
      if (!checked.ok) throw new Refused(400, `Alt text ${checked.error}.`);
      // The type is decided by the bytes, never by the client's content type or file name.
      const input = new Uint8Array(await file.arrayBuffer());
      if (input[0] !== 0xff || input[1] !== 0xd8 || input[2] !== 0xff) throw new Refused(415, "Only JPEG images are supported.");
      let bytes: Uint8Array, size: { width: number; height: number; type?: string };
      try { bytes = stripJpeg(input).bytes; } catch (error) {
        throw new Refused(400, error instanceof Error && /orientation/i.test(error.message) ? "This photo is stored rotated (EXIF orientation). Rotate it upright and try again." : "That file could not be read as a JPEG.");
      }
      try { size = imageSize(bytes); } catch { throw new Refused(400, "That file could not be read as a JPEG."); }
      if (size.type !== "jpg") throw new Refused(415, "Only JPEG images are supported.");
      const key = `site/images/${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.jpg`;
      const draft = { url: "https://placeholder.invalid/", width: size.width, height: size.height, alt: checked.value };
      if (!validateValue({ kind: "image", label: "", group: "" }, draft).ok) throw new Refused(400, "That image has an unsupported size.");
      const { url } = await blob.put(key, Buffer.from(bytes), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg" });
      const image = validateValue({ kind: "image", label: "", group: "" }, { ...draft, url });
      if (!image.ok) throw new Error("Blob returned an unusable image URL.");
      return json(image.value as ImageValue);
    }),
  };
}
