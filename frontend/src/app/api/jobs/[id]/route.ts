import { NextResponse } from "next/server";
import { fetchJobDetail } from "@/lib/job-data-service";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
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

