import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createJob } from "@/lib/job-service";
import { jobQueue } from "@/lib/job-queue";
import { fetchJobList } from "@/lib/job-data-service";
import { uploadFile } from "@/lib/s3-service";
import { validateStartup } from "@/lib/startup-validation";

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

    const formData = await request.formData();
    const file = formData.get("taskZip") as File | null;
    const runsRequested = parseInt(formData.get("runsRequested") as string) || 10;

    if (!file) {
      return NextResponse.json(
        { error: "No file uploaded" },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.name.endsWith(".zip")) {
      return NextResponse.json(
        { error: "File must be a .zip archive" },
        { status: 400 }
      );
    }

    // Extract task name from filename (remove .zip extension)
    const taskName = file.name.replace(/\.zip$/, "");

    // Generate S3 key with timestamp for uniqueness
    const timestamp = Date.now();
    const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const s3Key = `tasks/${timestamp}-${safeFileName}`;

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

    console.log(`[API] Created job ${job.id}`);

    // Enqueue for processing
    jobQueue.enqueue({
      jobId: job.id,
      taskName: job.taskName,
      zipPath: job.zipObjectUrl!, // Pass S3 URL to worker
      runsRequested: job.runsRequested,
    });

    return NextResponse.json({
      jobId: job.id,
      taskName: job.taskName,
      status: job.status,
    });
  } catch (error) {
    console.error("[API] Error creating job:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create job" },
      { status: 500 }
    );
  }
}
