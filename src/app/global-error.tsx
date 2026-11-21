"use client";
// Shown instead of Next's bare 500 when the root layout itself throws (it reads the published overlay). Self-contained:
// global-error replaces the layout, so it brings its own document and styles.
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="en"><body style={{ margin: 0, padding: "72px 24px", font: "16px/1.6 system-ui, sans-serif", color: "#1f1d1a", background: "#fbfaf7" }}>
    <title>Something went wrong</title>
    <main style={{ maxWidth: 560, margin: "0 auto" }}><h1 style={{ fontSize: 22, fontWeight: 500, margin: "0 0 8px" }}>This page could not be loaded.</h1><p style={{ margin: "0 0 20px" }}>It is a problem on the site&apos;s side, and usually a short one.</p><button type="button" onClick={() => retry()} style={{ font: "inherit", padding: "6px 14px", border: "1px solid currentColor", borderRadius: 10, background: "none", color: "inherit", cursor: "pointer" }}>Try again</button></main>
  </body></html>;
}
