 "use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UploadPanel() {
  const [runs, setRuns] = useState(10);

  return (
    <Card className="border-dashed border-2 border-zinc-200 bg-white">
      <CardHeader>
        <CardTitle>Upload Terminal-Bench task</CardTitle>
        <CardDescription>
          Provide a zipped task directory. We’ll run Terminus 2 ten times and surface every agent episode.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label
          htmlFor="taskZip"
          className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 px-6 py-10 text-center hover:border-zinc-400"
        >
          <span className="text-sm font-medium text-zinc-700">
            Drag & drop zip here or click to browse
          </span>
          <span className="text-xs text-zinc-500">
            .zip up to 1 GB • We validate task.toml before starting
          </span>
          <Input id="taskZip" type="file" accept=".zip" className="hidden" />
        </label>

        <div className="flex items-center gap-3">
          <div className="flex-1 space-y-1">
            <label htmlFor="runs" className="text-sm font-medium text-zinc-700">
              Runs per task
            </label>
            <Input
              id="runs"
              type="number"
              min={1}
              max={20}
              value={runs}
              onChange={(event) => setRuns(Number(event.target.value))}
            />
          </div>
          <Button className="mt-6" disabled>
            Upload & queue
          </Button>
        </div>
        <p className="text-xs text-zinc-500">
          Live API wiring is coming next. For now this form is a placeholder.
        </p>
      </CardContent>
    </Card>
  );
}

