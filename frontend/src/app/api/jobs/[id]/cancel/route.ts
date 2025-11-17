import { NextResponse } from "next/server";
import { cancelJob } from "@/lib/job-worker";
import { updateJobStatus } from "@/lib/job-service";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    
    console.log(`[API] Cancellation requested for job ${id}`);
    
    // Try to cancel the running job
    const cancelled = cancelJob(id);
    
    if (cancelled) {
      // Update database status
      await updateJobStatus(id, "failed", "Job cancelled by user");
      
      return NextResponse.json({
        success: true,
        message: "Job cancellation initiated",
      });
    } else {
      // Job not currently running (might be queued or already finished)
      return NextResponse.json({
        success: false,
        message: "Job is not currently running",
      }, { status: 400 });
    }
  } catch (error) {
    console.error("[API] Error cancelling job:", error);
    return NextResponse.json(
      { error: "Failed to cancel job" },
      { status: 500 }
    );
  }
}

