import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { fileExists } from "@/lib/s3-service";

/**
 * Health check endpoint for monitoring and load balancers
 * Checks database connectivity and S3 access
 */
export async function GET() {
  const checks = {
    status: "healthy" as "healthy" | "degraded" | "unhealthy",
    timestamp: new Date().toISOString(),
    services: {
      database: {
        status: "unknown" as "healthy" | "unhealthy",
        message: "",
      },
      s3: {
        status: "unknown" as "healthy" | "unhealthy",
        message: "",
      },
    },
  };

  // Check database connection
  try {
    if (!db) {
      checks.services.database.status = "unhealthy";
      checks.services.database.message = "Database client not initialized";
    } else {
      // Simple query to verify connection using Drizzle's raw SQL
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`SELECT 1`);
      checks.services.database.status = "healthy";
      checks.services.database.message = "Connected";
    }
  } catch (error) {
    checks.services.database.status = "unhealthy";
    checks.services.database.message =
      error instanceof Error ? error.message : "Connection failed";
  }

  // Check S3 access
  try {
    // Try to check if a test file exists (this verifies credentials and bucket access)
    // Using a non-existent key to avoid creating files, just testing access
    const testKey = "__health_check__";
    await fileExists(testKey);
    checks.services.s3.status = "healthy";
    checks.services.s3.message = "Accessible";
  } catch (error) {
    checks.services.s3.status = "unhealthy";
    checks.services.s3.message =
      error instanceof Error ? error.message : "Access failed";
  }

  // Determine overall status
  if (
    checks.services.database.status === "unhealthy" ||
    checks.services.s3.status === "unhealthy"
  ) {
    checks.status = "unhealthy";
  } else if (
    checks.services.database.status === "healthy" &&
    checks.services.s3.status === "healthy"
  ) {
    checks.status = "healthy";
  } else {
    checks.status = "degraded";
  }

  // Return appropriate HTTP status
  const httpStatus =
    checks.status === "healthy" ? 200 : checks.status === "degraded" ? 200 : 503;

  return NextResponse.json(checks, { status: httpStatus });
}

