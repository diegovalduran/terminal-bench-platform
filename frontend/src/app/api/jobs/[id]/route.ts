import { NextResponse } from "next/server";
import { fetchJobDetail } from "@/lib/mock-service";

interface Params {
  params: { id: string };
}

export async function GET(_request: Request, { params }: Params) {
  const { job } = await fetchJobDetail(params.id);
  return NextResponse.json({ job });
}

