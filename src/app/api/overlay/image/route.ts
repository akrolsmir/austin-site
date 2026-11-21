import { overlayHandlers } from "../handlers";

// POST multipart `file` (+ `alt`): strip metadata from a JPEG, store it on Blob, and return the image slot value (owner only).
export const dynamic = "force-dynamic";
export const POST = overlayHandlers().image;
