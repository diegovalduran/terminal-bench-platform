import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";
import { eq, or, and, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    if (!db) {
      return NextResponse.json(
        { error: "Database not available" },
        { status: 500 }
      );
    }

    const session = await auth();
    
    // Get all active and queued jobs across all users
    const allJobs = await db
      .select({
        status: jobs.status,
        ownerId: jobs.ownerId,
      })
      .from(jobs)
      .where(or(eq(jobs.status, "running"), eq(jobs.status, "queued")));

    // Calculate system-wide stats
    const runningCount = allJobs.filter((j) => j.status === "running").length;
    const queuedCount = allJobs.filter((j) => j.status === "queued").length;
    
    // Count unique users with active jobs
    const activeUsers = new Set(
      allJobs.filter((j) => j.status === "running").map((j) => j.ownerId)
    ).size;

    const systemStatus = {
      running: runningCount,
      queued: queuedCount,
      maxConcurrent: 5, // System max
      available: Math.max(0, 5 - runningCount),
      activeUsers,
    };

    // If user is authenticated, include their personal queue status
    let userStatus = null;
    if (session?.user?.id) {
      const userJobs = allJobs.filter((j) => j.ownerId === session.user.id);
      const activeCount = userJobs.filter((j) => j.status === "running").length;
      const userQueuedCount = userJobs.filter((j) => j.status === "queued").length;
      const maxActive = 5;
      const maxQueued = 5;

      userStatus = {
        hasActiveJob: activeCount > 0,
        activeJobCount: activeCount,
        maxActivePerUser: maxActive,
        queuedCount: userQueuedCount,
        maxQueued,
        canQueueMore: activeCount < maxActive && userQueuedCount < maxQueued,
      };
    }
    
    return NextResponse.json({
      status: "ok",
      queue: systemStatus,
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
