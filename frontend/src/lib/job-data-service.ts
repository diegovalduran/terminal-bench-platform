import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { episodes, jobs } from "@/db/schema";
import { JobDetailResponse, JobListResponse } from "@/types/runs";

export async function fetchJobList(): Promise<JobListResponse> {
  if (!db) {
    throw new Error("Database not initialized. Please check DATABASE_URL environment variable.");
  }

  const dbJobs = await db
    .select({
      id: jobs.id,
      taskName: jobs.taskName,
      status: jobs.status,
      runsRequested: jobs.runsRequested,
      runsCompleted: jobs.runsCompleted,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .orderBy(jobs.createdAt);

  return {
    jobs: dbJobs.map((job) => ({
      ...job,
      createdAt: job.createdAt.toISOString(),
    })),
  };
}

export async function fetchJobDetail(jobId: string): Promise<JobDetailResponse> {
  if (!db) {
    throw new Error("Database not initialized. Please check DATABASE_URL environment variable.");
  }

  const jobRecord = await db.query.jobs.findFirst({
    where: (table, { eq }) => eq(table.id, jobId),
  });

  if (!jobRecord) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const attemptRecords = await db.query.attempts.findMany({
    where: (table, { eq }) => eq(table.jobId, jobId),
    orderBy: (table, { asc }) => [asc(table.index)],
  });

  const attemptIds = attemptRecords.map((attempt) => attempt.id);
  const episodeRecords = attemptIds.length
    ? await db
        .select()
        .from(episodes)
        .where(inArray(episodes.attemptId, attemptIds))
    : [];

  return {
    job: {
      id: jobRecord.id,
      taskName: jobRecord.taskName,
      status: jobRecord.status as JobDetailResponse["job"]["status"],
      runsRequested: jobRecord.runsRequested,
      runsCompleted: jobRecord.runsCompleted,
      createdAt: jobRecord.createdAt.toISOString(),
      attempts: attemptRecords.map((attempt) => ({
        id: attempt.id,
        index: attempt.index,
        status: attempt.status as JobDetailResponse["job"]["attempts"][number]["status"],
        testsPassed: attempt.testsPassed,
        testsTotal: attempt.testsTotal,
        startedAt: attempt.startedAt?.toISOString(),
        finishedAt: attempt.finishedAt?.toISOString(),
        rewardSummary: attempt.rewardSummary ?? undefined,
        logPath: attempt.logPath ?? undefined,
        episodes: episodeRecords
          .filter((episode) => episode.attemptId === attempt.id)
          .map((episode) => ({
            id: episode.id,
            index: episode.index,
            stateAnalysis: episode.stateAnalysis,
            explanation: episode.explanation,
            commands: episode.commands ?? [],
            durationMs: episode.durationMs ?? undefined,
          })),
      })),
    },
  };
}

