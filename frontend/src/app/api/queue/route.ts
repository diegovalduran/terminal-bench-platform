import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { jobQueue } from "@/lib/job-queue";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const status = jobQueue.getStatus();
    
    // If user is authenticated, include their personal queue status
    const userStatus = session?.user?.id
      ? jobQueue.getUserQueueStatus(session.user.id)
      : null;
    
    return NextResponse.json({
      status: "ok",
      queue: status,
      user: userStatus,
    });
  } catch (error) {
    console.error("[API] Error fetching queue status:", error);
    return NextResponse.json(
      { error: "Failed to fetch queue status" },
      { status: 500 }
    );
  }
}

