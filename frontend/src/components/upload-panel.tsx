"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { X, Upload, Loader2 } from "lucide-react";

interface FileWithProgress {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
  jobId?: string;
}

const MAX_FILES = 25;

export function UploadPanel() {
  const router = useRouter();
  const [runs, setRuns] = useState(10);
  const [files, setFiles] = useState<FileWithProgress[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    addFiles(selectedFiles);
    // Reset input so same file can be selected again
    event.target.value = "";
  };

  const addFiles = (newFiles: File[]) => {
    const validFiles = newFiles.filter((file) => file.name.endsWith(".zip"));
    const invalidFiles = newFiles.filter((file) => !file.name.endsWith(".zip"));

    if (invalidFiles.length > 0) {
      toast.error(`${invalidFiles.length} file(s) skipped. Only .zip files are allowed.`);
    }

    const currentCount = files.length;
    const remainingSlots = MAX_FILES - currentCount;

    if (validFiles.length > remainingSlots) {
      toast.error(`Maximum ${MAX_FILES} files allowed. Only adding first ${remainingSlots} files.`);
      validFiles.splice(remainingSlots);
    }

    const newFileEntries: FileWithProgress[] = validFiles.map((file) => ({
      file,
      progress: 0,
      status: "pending",
    }));

    setFiles((prev) => [...prev, ...newFileEntries]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
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

    const droppedFiles = Array.from(event.dataTransfer.files);
    addFiles(droppedFiles);
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      toast.error("Please select at least one zip file");
      return;
    }

    setUploading(true);

    // Update all files to uploading status
    setFiles((prev) =>
      prev.map((f) => ({ ...f, status: "uploading" as const, progress: 0 }))
    );

    try {
      const formData = new FormData();
      files.forEach((fileEntry) => {
        formData.append("taskZip", fileEntry.file);
      });
      formData.append("runsRequested", runs.toString());

      // Simulate progress for better UX (since fetch doesn't support upload progress)
      const progressInterval = setInterval(() => {
        setFiles((prev) =>
          prev.map((f) => {
            if (f.status === "uploading" && f.progress < 90) {
              return { ...f, progress: Math.min(f.progress + 10, 90) };
            }
            return f;
          })
        );
      }, 200);

      const response = await fetch("/api/jobs", {
        method: "POST",
        body: formData,
      });

      clearInterval(progressInterval);

      // Set all to 100% before processing response
      setFiles((prev) =>
        prev.map((f) => ({ ...f, progress: 100 }))
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      // Update file statuses based on results
      if (data.results && Array.isArray(data.results)) {
        setFiles((prev) =>
          prev.map((fileEntry, index) => {
            const result = data.results[index];
            if (result) {
              if (result.status === "queued") {
                return {
                  ...fileEntry,
                  status: "success" as const,
                  progress: 100,
                  jobId: result.jobId,
                };
              } else {
                return {
                  ...fileEntry,
                  status: "error" as const,
                  progress: 100,
                  error: result.error || "Upload failed",
                };
              }
            }
            return fileEntry;
          })
        );

        const successCount = data.results.filter((r: any) => r.status === "queued").length;
        const failCount = data.results.filter((r: any) => r.status === "failed").length;

        if (failCount > 0) {
          toast.warning(`Uploaded ${successCount} of ${files.length} files successfully. ${failCount} failed.`);
        } else {
          toast.success(`Successfully uploaded and queued ${successCount} task(s)!`);
        }

        // Redirect to first successful job, or home if all failed
        const firstSuccess = data.results.find((r: any) => r.status === "queued");
        if (firstSuccess) {
          setTimeout(() => {
            router.push(`/jobs/${firstSuccess.jobId}`);
          }, 1500);
        }
      } else {
        // Legacy single file response
        toast.success("Task uploaded successfully!", {
          description: `Job ${data.jobId?.slice(0, 8)}... queued for ${runs} runs`,
        });
        setTimeout(() => {
          router.push(`/jobs/${data.jobId}`);
        }, 1500);
      }
    } catch (err) {
      console.error("Upload error:", err);
      setFiles((prev) =>
        prev.map((f) =>
          f.status === "uploading"
            ? {
                ...f,
                status: "error" as const,
                error: err instanceof Error ? err.message : "Failed to upload task",
              }
            : f
        )
      );
      toast.error("Upload failed", {
        description: err instanceof Error ? err.message : "Failed to upload task",
      });
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <Card className="border-dashed border-2 border-zinc-200 bg-white">
      <CardHeader>
        <CardTitle>Upload Terminal-Bench tasks</CardTitle>
        <CardDescription>
          Upload up to {MAX_FILES} zipped task directories. We&apos;ll run Terminus 2 {runs} times per task and surface every agent episode.
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
          } ${files.length >= MAX_FILES ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <Upload className="h-8 w-8 text-zinc-400 mb-2" />
          <span className="text-sm font-medium text-zinc-700">
            {files.length === 0
              ? "Drag & drop zip files here or click to browse"
              : `${files.length} file(s) selected (${MAX_FILES - files.length} remaining)`}
          </span>
          <span className="text-xs text-zinc-500">
            .zip up to 1 GB each • Maximum {MAX_FILES} files
          </span>
          <Input
            id="taskZip"
            type="file"
            accept=".zip"
            multiple
            className="hidden"
            onChange={handleFileChange}
            disabled={uploading || files.length >= MAX_FILES}
          />
        </label>

        {/* File List */}
        {files.length > 0 && (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {files.map((fileEntry, index) => (
              <div
                key={index}
                className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-zinc-800 truncate">
                      {fileEntry.file.name}
                    </p>
                    <span className="text-xs text-zinc-500 ml-2">
                      {formatFileSize(fileEntry.file.size)}
                    </span>
                  </div>
                  {fileEntry.status === "uploading" && (
                    <Progress value={fileEntry.progress} className="h-1.5" />
                  )}
                  {fileEntry.status === "success" && (
                    <div className="flex items-center gap-1 text-xs text-emerald-600">
                      <span>✓ Uploaded successfully</span>
                    </div>
                  )}
                  {fileEntry.status === "error" && (
                    <div className="flex items-center gap-1 text-xs text-rose-600">
                      <span>✗ {fileEntry.error || "Upload failed"}</span>
                    </div>
                  )}
                  {fileEntry.status === "pending" && (
                    <div className="h-1.5 rounded-full bg-zinc-100" />
                  )}
                </div>
                {!uploading && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-zinc-400 hover:text-zinc-900"
                    onClick={() => removeFile(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
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
            disabled={files.length === 0 || uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload & queue {files.length > 0 ? `(${files.length})` : ""}
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-zinc-500">
          {files.length > 0
            ? `Ready to upload ${files.length} file(s) (${files.reduce((sum, f) => sum + f.file.size, 0) / 1024 / 1024} MB total)`
            : "Select zip files to begin"}
        </p>
      </CardContent>
    </Card>
  );
}
