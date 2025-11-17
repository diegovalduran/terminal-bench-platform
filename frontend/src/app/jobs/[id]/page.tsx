"use client";

import { useJob } from "@/hooks/use-job";
import { JobOverview } from "@/components/job-overview";
import { AttemptCard } from "@/components/attempt-card";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";

interface JobDetailPageProps {
  params: { id: string };
}

export default function JobDetailPage({ params }: JobDetailPageProps) {
  const { id } = params;
  const { job, isLoading, isError } = useJob(id);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="flex items-center gap-2 text-zinc-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading job details...</span>
        </div>
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-zinc-900">Job not found</h2>
          <p className="text-sm text-zinc-500">
            The requested job could not be loaded.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 md:px-6">
        <header className="space-y-1">
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-zinc-500">
            Job Detail
          </p>
          <h1 className="text-3xl font-semibold text-zinc-900">
            {job.taskName}
          </h1>
          <p className="text-sm text-zinc-500">Job ID: {job.id}</p>
        </header>

        <JobOverview job={job} />

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900">
              Attempts ({job.attempts.length}/{job.runsRequested})
            </h2>
            {job.status === "processing" && (
              <div className="flex items-center gap-1.5 text-sm text-blue-600">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Updating live...</span>
              </div>
            )}
          </div>
          <Separator />
          <div className="grid gap-6">
            {job.attempts.length > 0 ? (
              job.attempts.map((attempt) => (
                <AttemptCard key={attempt.id} attempt={attempt} />
              ))
            ) : (
              <p className="text-center text-sm text-zinc-500">
                No attempts yet. Waiting for Harbor to start...
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

