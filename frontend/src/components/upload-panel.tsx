"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UploadPanel() {
  const router = useRouter();
  const [runs, setRuns] = useState(10);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] || null;
    setFile(selectedFile);
  };

  const handleDragOver = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);

    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith(".zip")) {
      setFile(droppedFile);
    } else {
      toast.error("Please drop a .zip file");
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error("Please select a zip file");
      return;
    }

    setUploading(true);

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

      toast.success("Task uploaded successfully!", {
        description: `Job ${data.jobId.slice(0, 8)}... queued for ${runs} runs`,
      });

      // Redirect to job detail page
      router.push(`/jobs/${data.jobId}`);
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("Upload failed", {
        description: err instanceof Error ? err.message : "Failed to upload task",
      });
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
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border px-6 py-10 text-center transition-colors ${
            isDragging
              ? "border-blue-400 bg-blue-50"
              : "border-zinc-200 bg-zinc-50 hover:border-zinc-400"
          }`}
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
