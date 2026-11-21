import { boolean, index, integer, jsonb, pgSchema, pgTable as publicTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { previewData } from "../lib/types";

// Previews and local dev keep their rows in a `preview` Postgres schema of the same database, so nothing done there shows
// up on (or is picked up by) production. Create it once with `SITE_DATA=preview bun run db:push`.
export const previewSchema = previewData() ? pgSchema("preview") : undefined;
const pgTable = (previewSchema ? previewSchema.table : publicTable) as typeof publicTable;

// Every table. Contract: docs/editable-site.md, "Auth and database". Tests create these in PGlite; production is Neon (`bun run db:push`).
const at = (name: string) => timestamp(name, { withTimezone: true });
const now = (name: string) => at(name).notNull().defaultNow();

// Better Auth core tables, in the shape its Drizzle adapter (better-auth 1.7) looks up: table exports named after the model
// (`user`, `session`, `account`, `verification`; no usePlural) and property names equal to its camelCase field names.
export const user = pgTable("user", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(), emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"), createdAt: now("created_at"), updatedAt: now("updated_at").$onUpdate(() => new Date()),
});
export const session = pgTable("session", {
  id: text("id").primaryKey(), expiresAt: at("expires_at").notNull(), token: text("token").notNull().unique(), createdAt: now("created_at"), updatedAt: now("updated_at").$onUpdate(() => new Date()),
  ipAddress: text("ip_address"), userAgent: text("user_agent"), userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (t) => [index("session_user_id_idx").on(t.userId)]);
export const account = pgTable("account", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(), userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"), accessTokenExpiresAt: at("access_token_expires_at"), refreshTokenExpiresAt: at("refresh_token_expires_at"),
  scope: text("scope"), password: text("password"), createdAt: now("created_at"), updatedAt: now("updated_at").$onUpdate(() => new Date()),
}, (t) => [index("account_user_id_idx").on(t.userId)]);
export const verification = pgTable("verification", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(), expiresAt: at("expires_at").notNull(), createdAt: now("created_at"), updatedAt: now("updated_at").$onUpdate(() => new Date()),
}, (t) => [index("verification_identifier_idx").on(t.identifier)]);

// Studio. Ids are crypto.randomUUID() set by the data functions. Private rows, `context`, and run_logs never reach a non-owner.
export type MessageContext = { route?: string; slot?: string; selector?: string; text?: string };
export type RunResult = { overlayHash?: string; previousOverlayHash?: string; branch?: string; prNumber?: number; prUrl?: string; mergeSha?: string; revertSha?: string; previewUrl?: string; guarded?: string[]; discarded?: boolean; error?: string };
export const RUN_STATUSES = ["queued", "running", "done", "failed", "stopped", "needs_publish", "reverted"] as const;
export const threads = pgTable("threads", { id: text("id").primaryKey(), title: text("title").notNull(), private: boolean("private").notNull().default(false), createdAt: now("created_at"), updatedAt: now("updated_at") });
export const messages = pgTable("messages", {
  id: text("id").primaryKey(), threadId: text("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }), role: text("role", { enum: ["owner", "claude"] }).notNull(), body: text("body").notNull(),
  private: boolean("private").notNull().default(false), context: jsonb("context").$type<MessageContext>(), runId: text("run_id"), createdAt: now("created_at"),
}, (t) => [index("messages_thread_idx").on(t.threadId, t.createdAt)]);
export const runs = pgTable("runs", {
  id: text("id").primaryKey(), threadId: text("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }), messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  lane: text("lane", { enum: ["fast", "code"] }).notNull(), status: text("status", { enum: RUN_STATUSES }).notNull().default("queued"), summary: text("summary"), result: jsonb("result").$type<RunResult>(),
  tokenHash: text("token_hash"), stopRequested: boolean("stop_requested").notNull().default(false), createdAt: now("created_at"), heartbeatAt: at("heartbeat_at"), startedAt: at("started_at"), endedAt: at("ended_at"),
}, (t) => [index("runs_thread_idx").on(t.threadId), index("runs_status_idx").on(t.status)]);
export const runSteps = pgTable("run_steps", {
  id: serial("id").primaryKey(), runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }), seq: integer("seq").notNull(), text: text("text").notNull(),
  state: text("state", { enum: ["doing", "done", "failed"] }).notNull().default("doing"), at: now("at"),
}, (t) => [index("run_steps_run_idx").on(t.runId, t.seq)]);
export const runLogs = pgTable("run_logs", {
  id: serial("id").primaryKey(), runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }), seq: integer("seq").notNull(), text: text("text").notNull(), at: now("at"),
}, (t) => [index("run_logs_run_idx").on(t.runId, t.seq)]);
