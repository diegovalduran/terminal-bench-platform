"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UploadPanel() {
  const router = useRouter();
  const [runs, setRuns] = useState(10);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] || null;
    setFile(selectedFile);
    setError(null);
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a zip file");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("taskZip", file);
      formData.append("runsRequested", runs.toString());

      const response = await fetch("/api/jobs", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Upload failed");
      }

      const data = await response.json();
      console.log("Job created:", data);

      // Redirect to job detail page
      router.push(`/jobs/${data.jobId}`);
    } catch (err) {
      console.error("Upload error:", err);
      setError(err instanceof Error ? err.message : "Failed to upload");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="border-dashed border-2 border-zinc-200 bg-white">
      <CardHeader>
        <CardTitle>Upload Terminal-Bench task</CardTitle>
        <CardDescription>
          Provide a zipped task directory. We&apos;ll run Terminus 2 {runs} times and surface every agent episode.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label
          htmlFor="taskZip"
          className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 px-6 py-10 text-center hover:border-zinc-400"
        >
          <span className="text-sm font-medium text-zinc-700">
            {file ? file.name : "Drag & drop zip here or click to browse"}
          </span>
          <span className="text-xs text-zinc-500">
            .zip up to 1 GB • We validate task.toml before starting
          </span>
          <Input
            id="taskZip"
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleFileChange}
            disabled={uploading}
          />
        </label>

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

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
              disabled={uploading}
            />
          </div>
          <Button
            className="mt-6"
            onClick={handleUpload}
            disabled={!file || uploading}
          >
            {uploading ? "Uploading..." : "Upload & queue"}
          </Button>
        </div>
        <p className="text-xs text-zinc-500">
          {file
            ? `Ready to upload ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`
            : "Select a zip file to begin"}
        </p>
      </CardContent>
    </Card>
  );
}
