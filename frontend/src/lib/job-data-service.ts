import { eq, inArray, sql, and, ne, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { episodes, jobs, attempts } from "@/db/schema";
import { JobDetailResponse, JobListResponse } from "@/types/runs";

export async function fetchJobList(userId?: string): Promise<JobListResponse> {
  if (!db) {
    throw new Error("Database not initialized. Please check DATABASE_URL environment variable.");
  }

  let query = db
    .select({
      id: jobs.id,
      taskName: jobs.taskName,
      status: jobs.status,
      runsRequested: jobs.runsRequested,
      runsCompleted: jobs.runsCompleted,
      createdAt: jobs.createdAt,
    })
    .from(jobs);

  // Filter by user if userId provided
  if (userId) {
    query = query.where(eq(jobs.ownerId, userId)) as typeof query;
  }

  const dbJobs = await query.orderBy(jobs.createdAt);

  // Get job IDs to count attempts passed
  const jobIds = dbJobs.map((job) => job.id);
  
  // Count attempts that passed (testsPassed === testsTotal && testsTotal > 0)
  // for each job
  const attemptsPassedCounts = jobIds.length > 0
    ? await db
        .select({
          jobId: attempts.jobId,
          count: sql<number>`count(*)::int`.as('count'),
        })
        .from(attempts)
        .where(
          and(
            inArray(attempts.jobId, jobIds),
            gt(attempts.testsTotal, 0),
            eq(attempts.testsPassed, attempts.testsTotal),
            ne(attempts.status, 'running'),
            ne(attempts.status, 'queued')
          )
        )
        .groupBy(attempts.jobId)
    : [];

  // Create a map for quick lookup
  const attemptsPassedMap = new Map(
    attemptsPassedCounts.map((item) => [item.jobId, item.count])
  );

  return {
    jobs: dbJobs.map((job) => ({
      ...job,
      status: job.status as JobListResponse["jobs"][number]["status"],
      createdAt: job.createdAt.toISOString(),
      attemptsPassed: attemptsPassedMap.get(job.id) ?? 0,
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
        metadata: attempt.metadata ? (attempt.metadata as { testCases?: Array<{ name: string; status: string; trace?: string; message?: string }> }) : undefined,
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

