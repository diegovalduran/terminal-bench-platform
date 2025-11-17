"use client";

import { useState, useMemo } from "react";
import { JobListItem, JobStatus } from "@/types/runs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { format } from "date-fns";
import { Search, ArrowUpDown } from "lucide-react";

interface JobListProps {
  jobs: JobListItem[];
}

const statusLabelStyles: Record<JobListItem["status"], string> = {
  queued: "bg-amber-100 text-amber-800",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
};

type SortOption = "newest" | "oldest" | "status" | "name";

export function JobList({ jobs }: JobListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus | "all">("all");
  const [sortBy, setSortBy] = useState<SortOption>("newest");

  const filteredAndSortedJobs = useMemo(() => {
    let filtered = [...jobs];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((job) =>
        job.taskName.toLowerCase().includes(query)
      );
    }

    // Filter by status
    if (statusFilter !== "all") {
      filtered = filtered.filter((job) => job.status === statusFilter);
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "newest":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "oldest":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "status":
          return a.status.localeCompare(b.status);
        case "name":
          return a.taskName.localeCompare(b.taskName);
        default:
          return 0;
      }
    });

    return filtered;
  }, [jobs, searchQuery, statusFilter, sortBy]);

  return (
    <Card className="border-zinc-200 shadow-sm">
      <CardHeader>
        <CardTitle>Recent jobs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              placeholder="Search by task name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Status Filter and Sort */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as JobStatus | "all")}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">
                  <div className="flex items-center gap-2">
                    <ArrowUpDown className="h-3 w-3" />
                    Newest
                  </div>
                </SelectItem>
                <SelectItem value="oldest">
                  <div className="flex items-center gap-2">
                    <ArrowUpDown className="h-3 w-3" />
                    Oldest
                  </div>
                </SelectItem>
                <SelectItem value="status">Status</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Results count */}
        {filteredAndSortedJobs.length !== jobs.length && (
          <p className="text-xs text-zinc-500">
            Showing {filteredAndSortedJobs.length} of {jobs.length} jobs
          </p>
        )}

        {/* Job list */}
        <div className="space-y-2">
          {filteredAndSortedJobs.length > 0 ? (
            filteredAndSortedJobs.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="flex items-center justify-between rounded-xl border border-transparent px-3 py-3 transition-all duration-200 hover:border-zinc-200 hover:bg-zinc-50 hover:shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900">{job.taskName}</p>
                  <p className="text-xs text-zinc-500">
                    {format(new Date(job.createdAt), "MMM d, HH:mm")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-sm text-zinc-600 sm:gap-3">
                  <span className="hidden sm:inline">
                    {job.runsCompleted}/{job.runsRequested}
                  </span>
                  <Badge className={`capitalize ${statusLabelStyles[job.status]}`}>
                    {job.status}
                  </Badge>
                </div>
              </Link>
            ))
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-zinc-500">No jobs found</p>
              {(searchQuery || statusFilter !== "all") && (
                <p className="mt-1 text-xs text-zinc-400">
                  Try adjusting your filters
                </p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

