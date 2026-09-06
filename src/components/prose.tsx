import Image from "next/image";
import parse, { Element, type HTMLReactParserOptions } from "html-react-parser";
import { marked } from "marked";

// Blob mirrors go through the Next image optimizer; other hosts are served as-is so no arbitrary host can be proxied.
const OPTIMIZED_HOST = /\.public\.blob\.vercel-storage\.com$/;
const SIZES = "(max-width: 760px) 100vw, 740px";
const options: HTMLReactParserOptions = {
  replace(node) {
    if (!(node instanceof Element) || node.name !== "img") return;
    const { src, alt = "", title = "" } = node.attribs;
    // The sync records intrinsic size as a "WxH" title; images without one keep layout-shifting plain markup.
    const [, width, height] = title.match(/^(\d+)x(\d+)$/) ?? [];
    // eslint-disable-next-line @next/next/no-img-element -- next/image needs intrinsic dimensions
    if (!src || !width) return <img src={src} alt={alt} loading="lazy" decoding="async" />;
    let unoptimized = true;
    try { unoptimized = !OPTIMIZED_HOST.test(new URL(src).hostname); } catch {}
    return <Image src={src} alt={alt} width={Number(width)} height={Number(height)} sizes={SIZES} unoptimized={unoptimized} />;
  },
};

export function Prose({ body }: { body: string }) {
  return <div className="prose">{parse(marked.parse(body, { gfm: true, breaks: true, async: false }), options)}</div>;
}
