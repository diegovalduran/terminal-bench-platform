"use client";

import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface QueueStatus {
  queued: number;
  running: number;
  maxConcurrent: number;
  available: number;
}

export function QueueStatus() {
  const { data, error, isLoading } = useSWR<{
    status: string;
    queue: QueueStatus;
  }>("/api/queue", fetcher, {
    refreshInterval: 2000, // Poll every 2 seconds
    revalidateOnFocus: true,
  });

  if (isLoading) {
    return (
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">System Status</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return null;
  }

  const { queue } = data;
  const isIdle = queue.running === 0 && queue.queued === 0;
  const isBusy = queue.running === queue.maxConcurrent;

  return (
    <Card className="border-zinc-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">System Status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-600">Status</span>
          <Badge
            className={`
              ${isIdle ? "bg-zinc-100 text-zinc-700" : ""}
              ${isBusy ? "bg-amber-100 text-amber-800" : ""}
              ${!isIdle && !isBusy ? "bg-emerald-100 text-emerald-800" : ""}
            `}
          >
            {isIdle && "Idle"}
            {isBusy && "Busy"}
            {!isIdle && !isBusy && "Processing"}
          </Badge>
        </div>

        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-zinc-600">Running</span>
            <span className="font-medium text-zinc-900">
              {queue.running}/{queue.maxConcurrent}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-600">Queued</span>
            <span className="font-medium text-zinc-900">{queue.queued}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-600">Available slots</span>
            <span className="font-medium text-emerald-600">
              {queue.available}
            </span>
          </div>
        </div>

        {queue.running > 0 && (
          <div className="pt-2 border-t border-zinc-100">
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>
                {queue.running} {queue.running === 1 ? "job" : "jobs"} running
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

