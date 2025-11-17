import { JobListItem } from "@/types/runs";

export const mockJobs: JobListItem[] = [
  {
    id: "job-sample-001",
    taskName: "build-cython-ext",
    status: "running",
    runsRequested: 10,
    runsCompleted: 4,
    createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  },
  {
    id: "job-sample-000",
    taskName: "regex-log",
    status: "completed",
    runsRequested: 10,
    runsCompleted: 10,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
  },
  {
    id: "job-sample-002",
    taskName: "dna-assembly",
    status: "queued",
    runsRequested: 10,
    runsCompleted: 0,
    createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
  },
];

