import { notFound } from "next/navigation";
import { fetchJobDetail } from "@/lib/mock-service";
import { JobOverview } from "@/components/job-overview";
import { AttemptCard } from "@/components/attempt-card";
import { Separator } from "@/components/ui/separator";

interface JobDetailPageProps {
  params: { id: string };
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { id } = params;
  const { job } = await fetchJobDetail(id);

  if (!job) {
    notFound();
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
            <p className="text-sm text-zinc-500">
              Viewing mock data — wiring to live API soon
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

