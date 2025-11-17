import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskName: varchar("task_name", { length: 256 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  runsRequested: integer("runs_requested").notNull(),
  runsCompleted: integer("runs_completed").notNull().default(0),
  zipObjectUrl: text("zip_object_url"),
  ownerId: uuid("owner_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const attempts = pgTable("attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  testsPassed: integer("tests_passed").notNull().default(0),
  testsTotal: integer("tests_total").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  rewardSummary: jsonb("reward_summary").$type<Record<string, number>>(),
  logPath: text("log_path"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
});

export const episodes = pgTable("episodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  attemptId: uuid("attempt_id")
    .notNull()
    .references(() => attempts.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  stateAnalysis: text("state_analysis").notNull(),
  explanation: text("explanation").notNull(),
  commands: jsonb("commands").$type<
    {
      command: string;
      output: string;
      exitCode?: number;
    }[]
  >(),
  durationMs: integer("duration_ms"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
});
import { pgTable, uuid, varchar, integer, jsonb, timestamp, text } from "drizzle-orm/pg-core";

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskName: varchar("task_name", { length: 256 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  runsRequested: integer("runs_requested").notNull(),
  runsCompleted: integer("runs_completed").default(0).notNull(),
  zipObjectUrl: text("zip_object_url"),
  ownerId: uuid("owner_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const attempts = pgTable("attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  testsPassed: integer("tests_passed").default(0).notNull(),
  testsTotal: integer("tests_total").default(0).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  rewardSummary: jsonb("reward_summary").$type<Record<string, number>>(),
  logPath: text("log_path"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
});

export const episodes = pgTable("episodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  attemptId: uuid("attempt_id")
    .notNull()
    .references(() => attempts.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  stateAnalysis: text("state_analysis").notNull(),
  explanation: text("explanation").notNull(),
  commands: jsonb("commands").$type<
    {
      command: string;
      output: string;
      exitCode?: number;
    }[]
  >(),
  durationMs: integer("duration_ms"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
});

