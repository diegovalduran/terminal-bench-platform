import { JobSummary } from "@/types/runs";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const statusColorMap: Record<JobSummary["status"], string> = {
  queued: "bg-amber-100 text-amber-800",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
};

interface JobOverviewProps {
  job: JobSummary;
}

export function JobOverview({ job }: JobOverviewProps) {
  const completionPercent = Math.round(
    (job.runsCompleted / job.runsRequested) * 100
  );

  return (
    <Card className="border-zinc-200 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Task</p>
          <CardTitle className="text-2xl">{job.taskName}</CardTitle>
          <p className="text-sm text-zinc-500">
            Created{" "}
            {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
          </p>
        </div>
        <Badge
          className={`capitalize ${statusColorMap[job.status]} hover:${statusColorMap[job.status]}`}
        >
          {job.status}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm text-zinc-600">
          <span>
            Runs completed {job.runsCompleted}/{job.runsRequested}
          </span>
          <span>{completionPercent}%</span>
        </div>
        <div className="h-2 rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-zinc-900 transition-all"
            style={{ width: `${completionPercent}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

