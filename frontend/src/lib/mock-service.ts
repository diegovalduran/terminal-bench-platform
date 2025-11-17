import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { episodes, jobs } from "@/db/schema";
import { JobDetailResponse, JobListResponse } from "@/types/runs";
import { mockJob } from "@/data/mock-job";
import { mockJobs } from "@/data/mock-jobs";

export async function fetchJobList(): Promise<JobListResponse> {
  if (db) {
    try {
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

      // Always return DB data if we have any, otherwise fall back to mock
      if (dbJobs.length > 0) {
        return {
          jobs: dbJobs.map((job) => ({
            ...job,
            createdAt: job.createdAt.toISOString(),
          })),
        };
      }
    } catch (error) {
      console.error("[mock-service] Error fetching jobs from DB:", error);
    }
  }

  // Fallback to mock data only if DB is unavailable or empty
  return { jobs: mockJobs };
}

export async function fetchJobDetail(jobId: string): Promise<JobDetailResponse> {
  if (db) {
    try {
      const jobRecord = await db.query.jobs.findFirst({
        where: (table, { eq }) => eq(table.id, jobId),
      });

      if (jobRecord) {
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
    } catch (error) {
      console.error("[mock-service] Error fetching job detail from DB:", error);
    }
  }

  // Fallback to mock data only if DB is unavailable or job not found
  if (jobId === mockJob.id) {
    return { job: mockJob };
  }

  // Return mock job with adjusted ID to show it's a fallback
  return {
    job: {
      ...mockJob,
      id: jobId,
      taskName: `${mockJob.taskName} (not found, showing mock)`,
    },
  };
}
