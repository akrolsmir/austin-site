import { defineConfig } from "drizzle-kit";

// `bun run db:push` applies src/db/schema.ts to the database in DATABASE_URL (bun loads .env.local for the script).
export default defineConfig({ dialect: "postgresql", schema: "./src/db/schema.ts", out: "./drizzle", dbCredentials: { url: process.env.DATABASE_URL ?? "" } });
