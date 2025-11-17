import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { episodes, jobs } from "@/db/schema";
import { JobDetailResponse, JobListResponse, JobStatus } from "@/types/runs";
import { mockJob } from "@/data/mock-job";
import { mockJobs } from "@/data/mock-jobs";

export async function fetchJobList(): Promise<JobListResponse> {
  if (db) {
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

    if (dbJobs.length) {
      const normalizedJobs = dbJobs.map((job) => ({
        ...job,
        status: job.status as JobStatus,
        createdAt: job.createdAt.toISOString(),
      }));
      return { jobs: normalizedJobs };
    }
  }

  return { jobs: mockJobs };
}

export async function fetchJobDetail(jobId: string): Promise<JobDetailResponse> {
  if (db) {
    const jobRecord = await db.query.jobs.findFirst({
      where: (table) => eq(table.id, jobId),
    });

    if (jobRecord) {
      const attemptRecords = await db.query.attempts.findMany({
        where: (table) => eq(table.jobId, jobId),
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
            rewardSummary: attempt.rewardSummary
              ? (attempt.rewardSummary as Record<string, number>)
              : undefined,
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
  }

  // In a real implementation we'd fetch by ID. For now, reuse the single mock job.
  if (jobId === mockJob.id) {
    return { job: mockJob };
  }

  // Fallback – return the mock job but with metadata adjusted to show the ID mismatch
  return {
    job: {
      ...mockJob,
      id: jobId,
      taskName: `${mockJob.taskName} (mock for ${jobId})`,
    },
  };
}

