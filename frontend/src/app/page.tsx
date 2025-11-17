"use client";

import { UploadPanel } from "@/components/upload-panel";
import { JobList } from "@/components/job-list";
import { QueueStatus } from "@/components/queue-status";
import { useJobs } from "@/hooks/use-jobs";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { jobs, isLoading } = useJobs();

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

        <div className="grid gap-6 md:grid-cols-[2fr,1fr]">
          <UploadPanel />
          <div className="space-y-4">
            <QueueStatus />
            {isLoading ? (
              <div className="flex items-center justify-center rounded-lg border border-zinc-200 bg-white p-8">
                <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
              </div>
            ) : (
              <JobList jobs={jobs} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
