"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useJob } from "@/hooks/use-job";
import { JobOverview } from "@/components/job-overview";
import { AttemptCard } from "@/components/attempt-card";
import { ErrorState } from "@/components/error-state";
import { JobDetailSkeleton } from "@/components/loading-skeleton";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, XCircle, Loader2 } from "lucide-react";

interface JobDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function JobDetailPage({ params }: JobDetailPageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { job, isLoading, isError, mutate } = useJob(id);
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    if (!confirm("Are you sure you want to cancel this job? This cannot be undone.")) {
      return;
    }

    setCancelling(true);
    try {
      const response = await fetch(`/api/jobs/${id}/cancel`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to cancel job");
      }

      toast.success("Job cancelled", {
        description: "The job has been stopped and marked as cancelled",
      });

      // Refresh job data
      mutate();
    } catch (error) {
      console.error("Cancel error:", error);
      toast.error("Failed to cancel job", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setCancelling(false);
    }
  };

  if (isLoading) {
    return <JobDetailSkeleton />;
  }

  if (isError || !job) {
    return (
      <div className="min-h-screen bg-zinc-50 py-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 md:px-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/")}
            className="mb-2 -ml-2 w-fit text-zinc-600 hover:text-zinc-900"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
          <ErrorState
            title="Job not found"
            message={
              isError
                ? "Unable to load job details. The job may not exist or there was a connection error."
                : "The requested job could not be found."
            }
            onRetry={() => mutate()}
            retryLabel="Reload"
          />
        </div>
      </div>
    );
  }

  const isRunning = job.status === "running" || job.status === "queued";

  // Calculate how many attempts passed (Agent Passed = all tests passed)
  const attemptsPassed = job.attempts.filter(
    (attempt) =>
      attempt.status !== "running" &&
      attempt.status !== "queued" &&
      attempt.testsTotal > 0 &&
      attempt.testsPassed === attempt.testsTotal
  ).length;
  const totalCompletedAttempts = job.attempts.filter(
    (attempt) => attempt.status !== "running" && attempt.status !== "queued"
  ).length;

  return (
    <div className="min-h-screen bg-zinc-50 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 md:px-6">
        <header className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-zinc-500">
              Job Detail
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/")}
              className="text-zinc-600 hover:text-zinc-900"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Home
            </Button>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-semibold text-zinc-900">
                  {job.taskName}
                </h1>
                {/* Score badge showing attempts passed */}
                {totalCompletedAttempts > 0 && (
                  <Badge
                    className={`text-sm font-semibold ${
                      attemptsPassed === totalCompletedAttempts
                        ? "bg-emerald-100 text-emerald-800"
                        : attemptsPassed > 0
                          ? "bg-amber-100 text-amber-800"
                          : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    {attemptsPassed}/{totalCompletedAttempts} Passed
                  </Badge>
                )}
              </div>
              <p className="text-sm text-zinc-500">Job ID: {job.id}</p>
            </div>
            {isRunning && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  <>
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancel Job
                  </>
                )}
              </Button>
            )}
          </div>
        </header>

        <JobOverview job={job} />

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900">
              Attempts ({job.attempts.length}/{job.runsRequested})
            </h2>
            {job.status === "running" && (
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
                <AttemptCard key={attempt.id} attempt={attempt} jobId={id} />
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

