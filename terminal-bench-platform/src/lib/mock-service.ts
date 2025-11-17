import { JobDetailResponse, JobListResponse } from "@/types/runs";
import { mockJob } from "@/data/mock-job";
import { mockJobs } from "@/data/mock-jobs";

export async function fetchJobList(): Promise<JobListResponse> {
  return { jobs: mockJobs };
}

export async function fetchJobDetail(jobId: string): Promise<JobDetailResponse> {
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

