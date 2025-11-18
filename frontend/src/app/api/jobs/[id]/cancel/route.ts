import { NextResponse } from "next/server";
import { updateJobStatus } from "@/lib/job-service";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    
    console.log(`[API] Cancellation requested for job ${id}`);
    
    if (!db) {
      return NextResponse.json(
        { error: "Database not available" },
        { status: 500 }
      );
    }
    
    // Check if job exists and is cancellable
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    
    if (!job) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 }
      );
    }
    
    if (job.status !== "running" && job.status !== "queued") {
      return NextResponse.json({
        success: false,
        message: `Job is ${job.status} and cannot be cancelled`,
      }, { status: 400 });
    }
    
    // Mark job as cancelled in database
    // Worker will check this status and stop processing
    await updateJobStatus(id, "failed", "Job cancelled by user");
    
    console.log(`[API] Job ${id} marked as cancelled in database`);
    
    return NextResponse.json({
      success: true,
      message: "Job cancellation requested. Worker will stop processing.",
    });
  } catch (error) {
    console.error("[API] Error cancelling job:", error);
    return NextResponse.json(
      { error: "Failed to cancel job" },
      { status: 500 }
    );
  }
}
