import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createJob } from "@/lib/job-service";
import { fetchJobList } from "@/lib/job-data-service";
import { uploadFile } from "@/lib/s3-service";
import { validateStartup } from "@/lib/startup-validation";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";
import { eq, and, or } from "drizzle-orm";

// Validate environment on first API call
validateStartup();

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Filter jobs by user
    const data = await fetchJobList(session.user.id);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Error fetching jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Check queue limit BEFORE creating job or uploading to S3
    if (!db) {
      return NextResponse.json(
        { error: "Database not available" },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const runsRequested = parseInt(formData.get("runsRequested") as string) || 10;
    
    // Get all files (support multiple uploads)
    const files: File[] = [];
    const fileEntries = formData.getAll("taskZip") as (File | string)[];
    
    for (const entry of fileEntries) {
      if (entry instanceof File) {
        files.push(entry);
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No files uploaded" },
        { status: 400 }
      );
    }

    // Validate file count (max 25)
    if (files.length > 25) {
      return NextResponse.json(
        { error: `Too many files. Maximum is 25 files per upload. You uploaded ${files.length} files.` },
        { status: 400 }
      );
    }

    // Validate all files are .zip
    for (const file of files) {
      if (!file.name.endsWith(".zip")) {
        return NextResponse.json(
          { error: `File "${file.name}" must be a .zip archive` },
          { status: 400 }
        );
      }
    }

    // Query database for user's active and queued jobs
    const userJobs = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.ownerId, session.user.id),
          or(eq(jobs.status, "running"), eq(jobs.status, "queued"))
        )
      );

    const activeCount = userJobs.filter((j) => j.status === "running").length;
    const queuedCount = userJobs.filter((j) => j.status === "queued").length;
    const maxActive = 25;  // Increased from 5 to 25
    const maxQueued = 25;  // Increased from 5 to 25

    // Check if user can queue more jobs
    const totalNewJobs = files.length;
    const totalAfterUpload = activeCount + queuedCount + totalNewJobs;
    
    if (activeCount >= maxActive && queuedCount + totalNewJobs > maxQueued) {
      return NextResponse.json(
        { 
          error: `You already have ${activeCount} active jobs and ${queuedCount} queued jobs. After uploading ${totalNewJobs} files, you would have ${queuedCount + totalNewJobs} queued jobs, which exceeds the maximum of ${maxQueued}. Please wait for your current jobs to complete.` 
        },
        { status: 429 }
      );
    } else if (activeCount + totalNewJobs > maxActive && queuedCount + totalNewJobs > maxQueued) {
      return NextResponse.json(
        { 
          error: `Uploading ${totalNewJobs} files would exceed your limits (${maxActive} active, ${maxQueued} queued). You currently have ${activeCount} active and ${queuedCount} queued jobs.` 
        },
        { status: 429 }
      );
    }

    // Process all files concurrently (upload to S3 and create jobs in parallel)
    const processFile = async (file: File, index: number): Promise<{ jobId: string; taskName: string; status: string; error?: string }> => {
      try {
        // Extract task name from filename (remove .zip extension)
        const taskName = file.name.replace(/\.zip$/, "");

        // Generate S3 key with timestamp and index for uniqueness
        const timestamp = Date.now();
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        const s3Key = `tasks/${timestamp}-${index}-${safeFileName}`;

        console.log(`[API] Uploading ${file.name} to S3: ${s3Key}`);

        // Upload file to S3
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const s3Url = await uploadFile(s3Key, buffer, "application/zip");

        console.log(`[API] Uploaded to S3: ${s3Url}`);

        // Create job in database with S3 URL
        const job = await createJob({
          taskName,
          zipPath: s3Url, // Store S3 URL (e.g., s3://bucket/tasks/123-file.zip)
          runsRequested,
          userId: session.user.id,
        });

        console.log(`[API] Created job ${job.id} with status "queued". Worker will pick it up.`);

        return {
          jobId: job.id,
          taskName: job.taskName,
          status: job.status,
        };
      } catch (error) {
        console.error(`[API] Error processing file ${file.name}:`, error);
        return {
          jobId: "",
          taskName: file.name.replace(/\.zip$/, ""),
          status: "failed",
          error: error instanceof Error ? error.message : "Failed to create job",
        };
      }
    };

    // Process all files concurrently using Promise.allSettled to handle individual failures
    const filePromises = files.map((file, index) => processFile(file, index));
    const settledResults = await Promise.allSettled(filePromises);
    
    // Extract results from settled promises
    const results = settledResults.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        return {
          jobId: "",
          taskName: files[index].name.replace(/\.zip$/, ""),
          status: "failed" as const,
          error: result.reason instanceof Error ? result.reason.message : "Failed to process file",
        };
      }
    });

    // Return results for all files
    const successCount = results.filter((r) => r.status === "queued").length;
    const failCount = results.filter((r) => r.status === "failed").length;

    if (failCount > 0) {
      return NextResponse.json(
        {
          results,
          message: `Uploaded ${successCount} of ${files.length} files successfully. ${failCount} failed.`,
        },
        { status: 207 } // Multi-Status
      );
    }

    return NextResponse.json({
      results,
      message: `Successfully uploaded and queued ${successCount} task(s)`,
    });
  } catch (error) {
    console.error("[API] Error creating job:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create job" },
      { status: 500 }
    );
  }
}
