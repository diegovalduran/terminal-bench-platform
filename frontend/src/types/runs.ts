export type AttemptStatus = "queued" | "running" | "success" | "failed";

export interface EpisodeCommand {
  command: string;
  output: string;
  exitCode?: number;
}

export interface Episode {
  id: string;
  index: number;
  stateAnalysis: string;
  explanation: string;
  commands: EpisodeCommand[];
  durationMs?: number;
}

export interface Attempt {
  id: string;
  index: number;
  status: AttemptStatus;
  testsPassed: number;
  testsTotal: number;
  startedAt?: string;
  finishedAt?: string;
  rewardSummary?: Record<string, number>;
  logPath?: string;
  episodes: Episode[];
}

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface JobSummary {
  id: string;
  taskName: string;
  status: JobStatus;
  runsRequested: number;
  runsCompleted: number;
  createdAt: string;
  attempts: Attempt[];
}

export interface JobListItem {
  id: string;
  taskName: string;
  status: JobStatus;
  runsRequested: number;
  runsCompleted: number;
  createdAt: string;
}

export interface JobDetailResponse {
  job: JobSummary;
}

export interface JobListResponse {
  jobs: JobListItem[];
}

export interface QueuedJob {
  jobId: string;
  taskName: string;
  zipPath: string;
  runsRequested: number;
  userId: string;
}
