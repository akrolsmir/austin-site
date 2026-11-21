// Dependency-free JPEG metadata stripping for album photos (which include children): drops every APPn segment except
// JFIF (APP0) and the ICC color profile (APP2), plus comments, so no EXIF, GPS, XMP, or maker notes survive.
// EXIF orientation is lost with it, so a rotated photo is refused rather than published sideways.
export type JpegInfo = { bytes: Uint8Array; taken?: string };

export function stripJpeg(input: Uint8Array): JpegInfo {
  if (input[0] !== 0xff || input[1] !== 0xd8) throw new Error("Not a JPEG.");
  const kept: Uint8Array[] = [input.subarray(0, 2)];
  let taken: string | undefined;
  let i = 2;
  while (i < input.length) {
    if (input[i] !== 0xff) throw new Error(`Malformed JPEG marker at byte ${i}.`);
    const marker = input[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xda || marker === 0xd9) { kept.push(input.subarray(i)); break; } // start of scan: the rest is image data
    const end = i + 2 + ((input[i + 2] << 8) | input[i + 3]);
    const segment = input.subarray(i, end);
    if (marker === 0xe1 && String.fromCharCode(...segment.subarray(4, 10)) === "Exif\0\0") taken ??= readExif(segment.subarray(10));
    if (!((marker >= 0xe1 && marker <= 0xef && marker !== 0xe2) || marker === 0xfe)) kept.push(segment);
    i = end;
  }
  const bytes = new Uint8Array(kept.reduce((n, part) => n + part.length, 0));
  kept.reduce((offset, part) => (bytes.set(part, offset), offset + part.length), 0);
  return { bytes, taken };
}

// Reads Orientation (IFD0 0x0112) and DateTimeOriginal (Exif IFD 0x9003) from a TIFF block; returns "YYYY-MM" if dated.
function readExif(tiff: Uint8Array): string | undefined {
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const le = view.getUint16(0) === 0x4949;
  const u16 = (o: number) => view.getUint16(o, le), u32 = (o: number) => view.getUint32(o, le);
  const entries = (ifd: number) => Array.from({ length: u16(ifd) }, (_, k) => ifd + 2 + k * 12);
  let taken: string | undefined;
  for (const e of entries(u32(4))) {
    if (u16(e) === 0x0112 && u16(e + 8) > 1) throw new Error("Photo has a non-default EXIF orientation; rotate it upright first (e.g. `convert -auto-orient`).");
    if (u16(e) === 0x8769) for (const x of entries(u32(e + 8))) if (u16(x) === 0x9003) taken = String.fromCharCode(...tiff.subarray(u32(x + 8), u32(x + 8) + 7)).replace(":", "-");
  }
  return /^\d{4}-\d{2}$/.test(taken ?? "") ? taken : undefined;
}
