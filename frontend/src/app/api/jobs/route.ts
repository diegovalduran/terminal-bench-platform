import { NextResponse } from "next/server";
import { fetchJobList } from "@/lib/mock-service";

export async function GET() {
  const list = await fetchJobList();
  return NextResponse.json(list);
}

export async function POST() {
  // Placeholder: would accept multipart upload and enqueue job.
  return NextResponse.json(
    { message: "Job creation coming soon. This endpoint is stubbed." },
    { status: 202 }
  );
}

