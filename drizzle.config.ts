import { defineConfig } from "drizzle-kit";
import { previewData } from "./src/lib/types";

// `bun run db:push` applies src/db/schema.ts to the database in DATABASE_URL (bun loads .env.local for the script).
// `SITE_DATA=preview bun run db:push` does the same for the `preview` schema that previews and local dev use.
export default defineConfig({ dialect: "postgresql", schema: "./src/db/schema.ts", out: "./drizzle", schemaFilter: [previewData() ? "preview" : "public"], dbCredentials: { url: process.env.DATABASE_URL ?? "" } });
