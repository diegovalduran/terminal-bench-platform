import { pgTable, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskName: varchar("task_name", { length: 255 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("queued"),
  runsRequested: integer("runs_requested").notNull().default(10),
  runsCompleted: integer("runs_completed").notNull().default(0),
  zipObjectUrl: text("zip_object_url"),
  ownerId: varchar("owner_id", { length: 255 }),
  metadata: jsonb("metadata"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const attempts = pgTable("attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("queued"),
  testsPassed: integer("tests_passed").notNull().default(0),
  testsTotal: integer("tests_total").notNull().default(0),
  rewardSummary: jsonb("reward_summary"),
  logPath: text("log_path"),
  harborTrialPath: text("harbor_trial_path"),
  metadata: jsonb("metadata"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const episodes = pgTable("episodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  attemptId: uuid("attempt_id").notNull().references(() => attempts.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  stateAnalysis: text("state_analysis").notNull(),
  explanation: text("explanation").notNull(),
  commands: jsonb("commands").notNull(),
  rawLogPath: text("raw_log_path"),
  durationMs: integer("duration_ms"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

