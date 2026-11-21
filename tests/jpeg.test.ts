import { test } from "node:test";
import assert from "node:assert/strict";
import { stripJpeg } from "../src/lib/jpeg";

const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
// Little-endian TIFF: IFD0 at 8 with Orientation and an Exif IFD pointer (at 38) holding DateTimeOriginal (string at 56).
function exif(orientation: number) {
  const tiff = [...ascii("II"), 42, 0, 8, 0, 0, 0, 2, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0x69, 0x87, 4, 0, 1, 0, 0, 0, 38, 0, 0, 0, 0, 0, 0, 0,
    1, 0, 0x03, 0x90, 2, 0, 20, 0, 0, 0, 56, 0, 0, 0, 0, 0, 0, 0, ...ascii("2026:07:23 20:10:30"), 0];
  return seg(0xe1, [...ascii("Exif"), 0, 0, ...tiff]);
}
const jpeg = (...segments: number[][]) => new Uint8Array([0xff, 0xd8, ...segments.flat(), ...seg(0xda, [1, 2, 3]), 9, 9, 0xff, 0xd9]);
const jfif = seg(0xe0, ascii("JFIF\0")), icc = seg(0xe2, ascii("ICC_PROFILE\0")), xmp = seg(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0<gps/>")), comment = seg(0xfe, ascii("hi"));

test("strips EXIF, XMP, and comments but keeps JFIF, ICC, and image data", () => {
  const { bytes, taken } = stripJpeg(jpeg(jfif, exif(1), xmp, icc, comment));
  assert.deepEqual([...bytes], [...jpeg(jfif, icc)]);
  assert.equal(taken, "2026-07");
});
test("refuses rotated photos and non-JPEGs", () => {
  assert.throws(() => stripJpeg(jpeg(exif(6))), /orientation/);
  assert.throws(() => stripJpeg(new Uint8Array([0x89, 0x50])), /Not a JPEG/);
});
test("undated photos have no capture month", () => assert.equal(stripJpeg(jpeg(jfif)).taken, undefined));
