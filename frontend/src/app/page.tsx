import { JobOverview } from "@/components/job-overview";
import { AttemptCard } from "@/components/attempt-card";
import { Separator } from "@/components/ui/separator";
import { UploadPanel } from "@/components/upload-panel";
import { JobList } from "@/components/job-list";
import { fetchJobDetail, fetchJobList } from "@/lib/mock-service";

export default async function Home() {
  const [{ job }, { jobs }] = await Promise.all([
    fetchJobDetail("job-sample-001"),
    fetchJobList(),
  ]);

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
          <JobList jobs={jobs} />
        </div>

        <JobOverview job={job} />

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900">
              Attempts ({job.attempts.length}/{job.runsRequested})
            </h2>
            <p className="text-sm text-zinc-500">
              Viewing mock data — live runs coming soon
            </p>
          </div>
          <Separator />
          <div className="grid gap-6">
            {job.attempts.map((attempt) => (
              <AttemptCard key={attempt.id} attempt={attempt} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
