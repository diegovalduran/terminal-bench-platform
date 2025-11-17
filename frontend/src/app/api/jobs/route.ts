import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { createJob } from "@/lib/job-service";
import { jobQueue } from "@/lib/job-queue";
import { fetchJobList } from "@/lib/job-data-service";

export async function GET() {
  try {
    const data = await fetchJobList();
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

    // Create uploads directory if it doesn't exist
    const uploadsDir = join(process.cwd(), "uploads");
    await mkdir(uploadsDir, { recursive: true });

    // Save file to disk
    const timestamp = Date.now();
    const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `${timestamp}-${safeFileName}`;
    const filePath = join(uploadsDir, fileName);

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    console.log(`[API] Saved upload to ${filePath}`);

    // Extract task name from filename (remove .zip extension)
    const taskName = file.name.replace(/\.zip$/, "");

    // Create job in database
    const job = await createJob({
      taskName,
      zipPath: filePath,
      runsRequested,
    });

    console.log(`[API] Created job ${job.id}`);

    // Enqueue for processing
    jobQueue.enqueue({
      jobId: job.id,
      taskName: job.taskName,
      zipPath: job.zipObjectUrl!,
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
