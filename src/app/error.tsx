"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main id="content"><h1>Austin&apos;s Notes</h1><button type="button" aria-label="Retry loading writing" onClick={reset} className="underline">↻</button> <a href="https://akrolsmir.notion.site/">Notion</a></main>; }
