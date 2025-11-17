import { db } from "@/db/client";
import { jobs } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export interface CreateJobParams {
  taskName: string;
  zipPath: string;
  runsRequested?: number;
  userId?: string;
}

export async function createJob(params: CreateJobParams) {
  if (!db) {
    throw new Error("Database not initialized");
  }

  const [job] = await db
    .insert(jobs)
    .values({
      taskName: params.taskName,
      zipObjectUrl: params.zipPath,
      runsRequested: params.runsRequested ?? 10,
      runsCompleted: 0,
      status: "queued",
      ownerId: params.userId ?? null,
    })
    .returning();

  return job;
}

export async function updateJobStatus(
  jobId: string,
  status: "queued" | "running" | "completed" | "failed",
  errorMessage?: string
) {
  if (!db) {
    throw new Error("Database not initialized");
  }

  await db
    .update(jobs)
    .set({
      status,
      errorMessage: errorMessage ?? null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

export async function incrementJobProgress(jobId: string) {
  if (!db) {
    throw new Error("Database not initialized");
  }

  await db
    .update(jobs)
    .set({
      runsCompleted: sql`${jobs.runsCompleted} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

