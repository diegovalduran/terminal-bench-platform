"use client";

import { UploadPanel } from "@/components/upload-panel";
import { JobList } from "@/components/job-list";
import { QueueStatus } from "@/components/queue-status";
import { ErrorState } from "@/components/error-state";
import { JobListSkeleton } from "@/components/loading-skeleton";
import { useJobs } from "@/hooks/use-jobs";

export default function Home() {
  const { jobs, isLoading, isError, mutate } = useJobs();

  return (
    <div className="min-h-screen bg-zinc-50 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 md:px-8">
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-zinc-500">
            Terminal Bench Platform
          </p>
          <h1 className="text-4xl font-semibold text-zinc-900">
            Scoring & Observability
          </h1>
          <p className="text-zinc-600">
            Upload Terminal-Bench tasks, run Terminus 2 ten times, and inspect
            the full agent timeline.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <UploadPanel />
          <div className="space-y-4">
            <QueueStatus />
            {isLoading ? (
              <JobListSkeleton />
            ) : isError ? (
              <ErrorState
                title="Failed to load jobs"
                message="Unable to fetch job list. Please check your connection and try again."
                onRetry={() => mutate()}
              />
            ) : (
              <JobList jobs={jobs} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
