# Austin's site

Next.js App Router, TypeScript, Tailwind CSS 4, deployed on Vercel. Source lives in `~/Code/austin-site`.

## Run

Use Node.js 24 LTS, `npm ci`, and `npm run dev`. Copy `.env.example` to `.env.local` and set the Notion token. Never commit environment files. Without a token, the app uses six real post titles with clearly placeholder Latin article bodies for local design work. With a token, configuration or API errors fail visibly; they never quietly switch to sample content.

## Designs

Option 4 is the default. The `4` / `5` control in the header remembers the visitor's choice in localStorage. `/?style=5` previews the plum design. Both styles share semantic markup, content, routes, and article rendering. Add an entry to `src/lib/styles.ts`, extend the pre-paint script in `src/app/layout.tsx`, and add scoped CSS to introduce another style. Article text remains server-rendered.

All editorial copy comes from Austin's public Notion content or lorem ipsum. Project names are existing examples, not synced or linked yet. Intro, work, and photos are placeholders. Operational accessibility/error labels describe controls and failures.

## Notion publication rules

The integration needs read content access to the Posts database. Its verified schema uses `Tags` (multi-select with `Draft`) and a `Date` formula combining Manual Date and Created time. The configured filter excludes Draft, and the client also excludes archived/trashed and future-dated posts. The filter is mandatory: a missing or malformed filter never produces an unfiltered query. This follows the current database convention; adding a new draft status requires updating the filter.

Index and recursive block requests paginate fully, retry 429/5xx responses with bounded backoff, and escape text via React. Non-web links are rejected. Child pages/databases are not automatically included. Published IDs form an allowlist before article content is fetched. Common blocks include headings, lists, images, code, quotes, callouts, toggles, tables, and columns. Unsupported blocks link to the original in Notion; equations currently render as text. Article IDs form stable URLs even when titles change.

## Five-minute refresh

Vercel Pro cron calls `/api/sync` every five minutes with `Authorization: Bearer CRON_SECRET`. The endpoint checks Notion before marking the shared cache stale, then requests `SITE_URL` to warm the homepage. It supports an authenticated POST for manual refresh. Production cron is only active on production deployments.

The site uses Next's persistent Data Cache and ISR, with a 300-second fallback revalidation interval. The cron refreshes the catalog; article bodies load on demand and use the post's last-edited timestamp in their cache key. Signed Notion image URLs are refreshed with the body. Cached pages survive upstream errors through ISR's last-successful-result behavior; a first uncached article can still fail during an outage.

This is stale-while-revalidate, not a hard five-minute delivery guarantee: the first response during revalidation can be stale and new content appears after regeneration. Removed/drafted posts can remain visible during that window. Already-open tabs do not auto-reload. No separate database, rebuild per edit, or full-archive download every five minutes is needed. For immediate takedowns, use blocking invalidation; for full offline archival, add a durable snapshot/media store. Notion-hosted images still depend on Notion availability.

## Verification

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

## Deployment

Linked to `austin-proj/austin-site`. Configure the `.env.example` keys in Vercel for production and preview. `SITE_URL` should be the final production URL. `vercel deploy` creates a preview; `vercel deploy --prod` activates production and the five-minute cron. Tokens stay server-side and out of Git.
