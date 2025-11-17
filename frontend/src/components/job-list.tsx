import { JobListItem } from "@/types/runs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { format } from "date-fns";

interface JobListProps {
  jobs: JobListItem[];
}

const statusLabelStyles: Record<JobListItem["status"], string> = {
  queued: "bg-amber-100 text-amber-800",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
};

export function JobList({ jobs }: JobListProps) {
  return (
    <Card className="border-zinc-200 shadow-sm">
      <CardHeader>
        <CardTitle>Recent jobs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {jobs.map((job) => (
          <Link
            key={job.id}
            href={`/jobs/${job.id}`}
            className="flex items-center justify-between rounded-xl border border-transparent px-3 py-3 transition hover:border-zinc-200 hover:bg-zinc-50"
          >
            <div>
              <p className="text-sm font-medium text-zinc-900">{job.taskName}</p>
              <p className="text-xs text-zinc-500">
                {format(new Date(job.createdAt), "MMM d, HH:mm")}
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm text-zinc-600">
              <span>
                {job.runsCompleted}/{job.runsRequested}
              </span>
              <Badge className={`capitalize ${statusLabelStyles[job.status]}`}>
                {job.status}
              </Badge>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

