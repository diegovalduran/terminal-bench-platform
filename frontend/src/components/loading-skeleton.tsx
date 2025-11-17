import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function JobListSkeleton() {
  return (
    <Card className="border-zinc-200 shadow-sm">
      <CardHeader>
        <div className="h-6 w-32 animate-pulse rounded bg-zinc-200" />
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search skeleton */}
        <div className="h-10 w-full animate-pulse rounded-md bg-zinc-200" />
        
        {/* Filter skeletons */}
        <div className="flex gap-2">
          <div className="h-10 flex-1 animate-pulse rounded-md bg-zinc-200" />
          <div className="h-10 flex-1 animate-pulse rounded-md bg-zinc-200" />
        </div>

        {/* Job items skeleton */}
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-3"
            >
              <div className="space-y-2">
                <div className="h-4 w-32 animate-pulse rounded bg-zinc-200" />
                <div className="h-3 w-24 animate-pulse rounded bg-zinc-200" />
              </div>
              <div className="flex items-center gap-3">
                <div className="h-4 w-12 animate-pulse rounded bg-zinc-200" />
                <div className="h-5 w-16 animate-pulse rounded bg-zinc-200" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function JobDetailSkeleton() {
  return (
    <div className="min-h-screen bg-zinc-50 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 md:px-6">
        {/* Header skeleton */}
        <div className="space-y-3">
          <div className="h-4 w-24 animate-pulse rounded bg-zinc-200" />
          <div className="h-8 w-64 animate-pulse rounded bg-zinc-200" />
        </div>

        {/* Overview skeleton */}
        <Card className="border-zinc-200 shadow-sm">
          <CardHeader>
            <div className="h-6 w-32 animate-pulse rounded bg-zinc-200" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-16 animate-pulse rounded bg-zinc-200" />
                  <div className="h-6 w-24 animate-pulse rounded bg-zinc-200" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Attempts skeleton */}
        <Card className="border-zinc-200 shadow-sm">
          <CardHeader>
            <div className="h-6 w-32 animate-pulse rounded bg-zinc-200" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-32 animate-pulse rounded-lg border border-zinc-200 bg-zinc-50"
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

