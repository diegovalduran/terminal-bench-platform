import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Users table for authentication
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  password: text("password").notNull(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Sessions table for NextAuth
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionToken: varchar("session_token", { length: 255 }).notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

// Accounts table for NextAuth (OAuth providers)
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 255 }).notNull(),
  provider: varchar("provider", { length: 255 }).notNull(),
  providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: varchar("token_type", { length: 255 }),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
});

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskName: varchar("task_name", { length: 256 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  runsRequested: integer("runs_requested").notNull(),
  runsCompleted: integer("runs_completed").notNull().default(0),
  zipObjectUrl: text("zip_object_url"),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  errorMessage: text("error_message"),
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
