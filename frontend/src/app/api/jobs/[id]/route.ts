import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchJobDetail } from "@/lib/job-data-service";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;
    
    // Verify job belongs to user
    if (db) {
      const jobRecord = await db
        .select({ ownerId: jobs.ownerId })
        .from(jobs)
        .where(eq(jobs.id, id))
        .limit(1);

      if (jobRecord.length === 0) {
        return NextResponse.json(
          { error: "Job not found" },
          { status: 404 }
        );
      }

      if (jobRecord[0].ownerId !== session.user.id) {
        return NextResponse.json(
          { error: "Forbidden" },
          { status: 403 }
        );
      }
    }

    const { job } = await fetchJobDetail(id);
    return NextResponse.json({ job });
  } catch (error) {
    console.error("[API] Error fetching job detail:", error);
    
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 }
      );
    }
    
    return NextResponse.json(
      { error: "Failed to fetch job details" },
      { status: 500 }
    );
  }
}

