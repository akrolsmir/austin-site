import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prose } from "../src/components/prose";

const render = (body: string) => renderToStaticMarkup(createElement(Prose, { body }));

test("sized images render through next/image, blob mirrors optimized and other hosts as-is", () => {
  const blob = render('![pic](https://x.public.blob.vercel-storage.com/a.png "1200x800")');
  assert.match(blob, /<img[^>]*alt="pic"[^>]*width="1200"[^>]*height="800"/);
  assert.match(blob, /srcset="\/_next\/image\?url=/i);
  assert.match(blob, /loading="lazy"/);
  assert.doesNotMatch(blob, /title=/);
  const external = render('- item\n  ![](https://i.imgur.com/a.png "640x480")');
  assert.match(external, /<li>[\s\S]*<img[^>]*width="640"[^>]*src="https:\/\/i\.imgur\.com\/a\.png"/);
  assert.doesNotMatch(external, /_next\/image/);
});

test("images without recorded dimensions stay plain lazy img tags", () => {
  const html = render("![alt text](https://imgs.xkcd.com/c.png)\n\nafter");
  assert.match(html, /<p><img src="https:\/\/imgs\.xkcd\.com\/c\.png" alt="alt text" loading="lazy" decoding="async"\/><\/p>/);
  assert.match(html, /<p>after<\/p>/);
});
