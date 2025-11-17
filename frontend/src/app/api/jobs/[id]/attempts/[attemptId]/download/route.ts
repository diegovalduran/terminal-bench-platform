import { NextRequest, NextResponse } from "next/server";
import { getSignedDownloadUrl } from "@/lib/s3-service";
import { db } from "@/db/client";
import { attempts } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Extract S3 key from S3 URL
 * @param s3Url - S3 URL in format "s3://bucket/key/path"
 * @param filePath - Optional file path to append (e.g., "agent/trajectory.json")
 * @returns The full S3 key
 */
function extractS3Key(s3Url: string, filePath?: string): string {
  if (!s3Url.startsWith("s3://")) {
    throw new Error(`Invalid S3 URL format: ${s3Url}`);
  }
  
  // Remove "s3://" prefix and bucket name
  const withoutProtocol = s3Url.slice(5); // Remove "s3://"
  const firstSlashIndex = withoutProtocol.indexOf("/");
  
  if (firstSlashIndex === -1) {
    throw new Error(`Invalid S3 URL format: ${s3Url}`);
  }
  
  const baseKey = withoutProtocol.slice(firstSlashIndex + 1);
  
  // If filePath is provided, append it to the base key
  if (filePath) {
    // Remove leading slash if present
    const cleanFilePath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
    return `${baseKey}${cleanFilePath}`;
  }
  
  return baseKey;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attemptId: string }> }
) {
  try {
    if (!db) {
      return NextResponse.json(
        { error: "Database not initialized" },
        { status: 500 }
      );
    }

    const { id: jobId, attemptId } = await params;
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get("file"); // Optional: specific file path (e.g., "agent/trajectory.json")
    const expiresIn = parseInt(searchParams.get("expiresIn") || "3600"); // Default 1 hour

    // Fetch attempt from database
    const attempt = await db.query.attempts.findFirst({
      where: (table, { eq, and }) => and(
        eq(table.id, attemptId),
        eq(table.jobId, jobId)
      ),
    });

    if (!attempt) {
      return NextResponse.json(
        { error: "Attempt not found" },
        { status: 404 }
      );
    }

    if (!attempt.logPath) {
      return NextResponse.json(
        { error: "No log path available for this attempt" },
        { status: 404 }
      );
    }

    // Extract S3 key from logPath
    const s3Key = extractS3Key(attempt.logPath, filePath || undefined);

    // Generate signed URL
    const signedUrl = await getSignedDownloadUrl(s3Key, expiresIn);

    return NextResponse.json({
      url: signedUrl,
      expiresIn,
      key: s3Key,
    });
  } catch (error) {
    console.error("[API] Error generating signed URL:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate download URL" },
      { status: 500 }
    );
  }
}

