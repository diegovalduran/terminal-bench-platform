import { NextResponse } from "next/server";
import { jobQueue } from "@/lib/job-queue";

export async function GET() {
  try {
    const status = jobQueue.getStatus();
    
    return NextResponse.json({
      status: "ok",
      queue: status,
    });
  } catch (error) {
    console.error("[API] Error fetching queue status:", error);
    return NextResponse.json(
      { error: "Failed to fetch queue status" },
      { status: 500 }
    );
  }
}

