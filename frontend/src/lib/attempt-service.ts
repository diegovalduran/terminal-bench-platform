import { db } from "@/db/client";
import { attempts, episodes } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface CreateAttemptParams {
  jobId: string;
  index: number;
  status: "queued" | "running" | "success" | "failed";
  testsPassed?: number;
  testsTotal?: number;
  rewardSummary?: Record<string, number>;
  logPath?: string;
}

export interface CreateEpisodeParams {
  attemptId: string;
  index: number;
  stateAnalysis: string;
  explanation: string;
  commands: Array<{
    command: string;
    output: string;
    exitCode?: number;
  }>;
  durationMs?: number;
}

export async function createAttempt(params: CreateAttemptParams) {
  if (!db) {
    throw new Error("Database not initialized");
  }

  const [attempt] = await db
    .insert(attempts)
    .values({
      jobId: params.jobId,
      index: params.index,
      status: params.status,
      testsPassed: params.testsPassed ?? 0,
      testsTotal: params.testsTotal ?? 0,
      rewardSummary: params.rewardSummary ?? {},
      logPath: params.logPath,
      startedAt: new Date(),
    })
    .returning();

  return attempt;
}

export async function updateAttempt(
  attemptId: string,
  updates: {
    status?: "queued" | "running" | "success" | "failed";
    testsPassed?: number;
    testsTotal?: number;
    rewardSummary?: Record<string, number>;
    finishedAt?: Date;
  }
) {
  if (!db) {
    throw new Error("Database not initialized");
  }

  const [attempt] = await db
    .update(attempts)
    .set(updates)
    .where(eq(attempts.id, attemptId))
    .returning();

  return attempt;
}

export async function createEpisode(params: CreateEpisodeParams) {
  if (!db) {
    throw new Error("Database not initialized");
  }

  const [episode] = await db
    .insert(episodes)
    .values({
      attemptId: params.attemptId,
      index: params.index,
      stateAnalysis: params.stateAnalysis,
      explanation: params.explanation,
      commands: params.commands,
      durationMs: params.durationMs,
    })
    .returning();

  return episode;
}

