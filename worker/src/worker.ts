#!/usr/bin/env node
/**
 * Standalone Worker Service
 * 
 * This worker service runs independently from the Next.js application.
 * It polls the database for queued jobs and processes them using the job queue.
 * 
 * Usage:
 *   npm run worker
 *   or
 *   node dist/worker.js (after building)
 */

// Load environment variables FIRST, before any other imports
import dotenv from "dotenv";
import { resolve } from "path";

// Try multiple locations: worker dir, parent dir (project root), frontend dir
const envPaths = [
  resolve(process.cwd(), ".env.local"),
  resolve(process.cwd(), "..", ".env.local"),
  resolve(process.cwd(), "..", "frontend", ".env.local"),
];

for (const envPath of envPaths) {
  dotenv.config({ path: envPath, override: false });
}

// Import types and utilities that don't depend on env vars
import { eq } from "drizzle-orm";
import { QueuedJob } from "./shared/types/runs";

// Dynamic imports for modules that depend on environment variables
// These will be imported after env vars are loaded

// Poll interval in milliseconds (default: 5 seconds)
const POLL_INTERVAL_MS = parseInt(
  process.env.WORKER_POLL_INTERVAL_MS || "5000",
  10
);

// Graceful shutdown handling
let isShuttingDown = false;
let pollInterval: NodeJS.Timeout | null = null;

/**
 * Fetch queued jobs from database and enqueue them
 */
async function processQueuedJobs() {
  // Dynamically import to ensure env vars are loaded
  const { db } = await import("./shared/db/client");
  const { jobs } = await import("./shared/db/schema");
  const { jobQueue } = await import("./shared/lib/job-queue");
  const { log } = await import("./shared/lib/logger");
  const { eq } = await import("drizzle-orm");

  if (!db) {
    log.error("Database not initialized", undefined, {
      context: "worker.processQueuedJobs",
    });
    return;
  }

  try {
    // Fetch jobs with status "queued"
    const queuedJobs = await db
      .select()
      .from(jobs)
      .where(eq(jobs.status, "queued"))
      .orderBy(jobs.createdAt);

    if (queuedJobs.length === 0) {
      // Log heartbeat every 10 polls (every ~50 seconds) to show worker is alive
      const pollCount = (global as any).pollCount = ((global as any).pollCount || 0) + 1;
      if (pollCount % 10 === 0) {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        process.stdout.write(`\n💓 [${timestamp}] [Worker] Polling... (no queued jobs)\n`);
      }
      return; // No jobs to process
    }

    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    process.stdout.write(`\n🔍 [${timestamp}] [Worker] Found ${queuedJobs.length} queued job(s)\n`);
    
    log.info(`Found ${queuedJobs.length} queued job(s)`, {
      context: "worker.processQueuedJobs",
    });

    // Enqueue each job
    for (const job of queuedJobs) {
      // Check user queue status before enqueueing
      if (job.ownerId) {
        const userQueueStatus = jobQueue.getUserQueueStatus(job.ownerId);
        
        // Skip if this specific job is already active for this user
        if (userQueueStatus.activeJobIds?.includes(job.id)) {
          log.debug(`Job ${job.id} already processing for user, skipping`, {
            context: "worker.processQueuedJobs",
          });
          continue;
        }
        if (!userQueueStatus.canQueueMore) {
          log.debug(
            `User ${job.ownerId} has reached queue limit, skipping job ${job.id}`,
            {
              context: "worker.processQueuedJobs",
            }
          );
          continue;
        }
      }

      try {
        // Convert database job to QueuedJob format
        const queuedJob: QueuedJob = {
          jobId: job.id,
          taskName: job.taskName,
          zipPath: job.zipObjectUrl || "",
          runsRequested: job.runsRequested,
          userId: job.ownerId || "",
        };

        // Enqueue to in-memory queue
        jobQueue.enqueue(queuedJob);

        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        process.stdout.write(`\n📥 [${timestamp}] [Worker] Enqueued job ${job.id.slice(0, 8)}... (${job.taskName})\n`);
        
        log.info(`Enqueued job ${job.id} (${job.taskName})`, {
          context: "worker.processQueuedJobs",
          jobId: job.id,
          taskName: job.taskName,
        });
      } catch (error) {
        log.error(
          "Failed to enqueue job",
          error instanceof Error ? error : new Error(String(error)),
          {
            context: "worker.processQueuedJobs",
            jobId: job.id,
          }
        );
      }
    }
  } catch (error) {
    log.error(
      "Error fetching queued jobs from database",
      error instanceof Error ? error : new Error(String(error)),
      {
        context: "worker.processQueuedJobs",
      }
    );
  }
}

/**
 * Start polling for queued jobs
 */
async function startPolling() {
  if (pollInterval) {
    return; // Already polling
  }

  const { log } = await import("./shared/lib/logger");
  log.info(`Starting worker with poll interval: ${POLL_INTERVAL_MS}ms`, {
    context: "worker.startPolling",
  });

  // Process immediately on start
  await processQueuedJobs();

  // Then poll periodically
  pollInterval = setInterval(async () => {
    if (!isShuttingDown) {
      await processQueuedJobs();
    }
  }, POLL_INTERVAL_MS);
}

/**
 * Stop polling and handle graceful shutdown
 */
async function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    const { log } = await import("./shared/lib/logger");
    log.info("Stopped polling for queued jobs", {
      context: "worker.stopPolling",
    });
  }
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    return; // Already shutting down
  }

  isShuttingDown = true;
  const { log } = await import("./shared/lib/logger");
  const { jobQueue } = await import("./shared/lib/job-queue");
  const { db } = await import("./shared/db/client");

  log.info(`Received ${signal}, initiating graceful shutdown...`, {
    context: "worker.gracefulShutdown",
  });

  // Stop polling
  await stopPolling();

  // Wait for current jobs to complete (with timeout)
  const maxWaitTime = 30000; // 30 seconds
  const startTime = Date.now();

  while (jobQueue.isProcessing() && Date.now() - startTime < maxWaitTime) {
    const status = jobQueue.getStatus();
    log.info(
      `Waiting for ${status.running} running job(s) and ${status.queued} queued job(s) to complete...`,
      {
        context: "worker.gracefulShutdown",
        running: status.running,
        queued: status.queued,
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (jobQueue.isProcessing()) {
    log.warn("Some jobs may not have completed before shutdown", {
      context: "worker.gracefulShutdown",
    });
  } else {
    log.info("All jobs completed, shutting down", {
      context: "worker.gracefulShutdown",
    });
  }

  // Close database connection if needed
  if (db) {
    // Drizzle uses pg Pool which handles cleanup automatically
    log.info("Database connection will be closed automatically", {
      context: "worker.gracefulShutdown",
    });
  }

  process.exit(0);
}

/**
 * Main entry point
 */
async function main() {
  // Dynamically import modules that depend on environment variables
  const { db } = await import("./shared/db/client");
  const { jobs } = await import("./shared/db/schema");
  const { validateStartup } = await import("./shared/lib/startup-validation");
  const { log } = await import("./shared/lib/logger");

  log.info("Starting Terminal-Bench Worker Service...", {
    context: "worker.main",
  });

  // Validate environment
  validateStartup();

  // Check database connection
  if (!db) {
    log.error(
      "Database not initialized. Check DATABASE_URL environment variable.",
      undefined,
      {
        context: "worker.main",
      }
    );
    process.exit(1);
  }

  // Test database connection
  try {
    await db.select().from(jobs).limit(1);
    log.info("Database connection successful", {
      context: "worker.main",
    });
  } catch (error) {
    log.error(
      "Database connection test failed",
      error instanceof Error ? error : new Error(String(error)),
      {
        context: "worker.main",
      }
    );
    process.exit(1);
  }

  // Register signal handlers for graceful shutdown
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  // Handle uncaught errors
  process.on("uncaughtException", async (error) => {
    const { log } = await import("./shared/lib/logger");
    log.error("Uncaught exception, shutting down", error, {
      context: "worker.uncaughtException",
    });
    await gracefulShutdown("uncaughtException");
  });

  process.on("unhandledRejection", async (reason, promise) => {
    const { log } = await import("./shared/lib/logger");
    log.error(
      "Unhandled promise rejection",
      reason instanceof Error ? reason : new Error(String(reason)),
      {
        context: "worker.unhandledRejection",
      }
    );
  });

  // Start polling for queued jobs
  await startPolling();

  log.info("Worker service started successfully", {
    context: "worker.main",
    pollInterval: POLL_INTERVAL_MS,
  });
}

// Run main function
main().catch(async (error) => {
  const { log } = await import("./shared/lib/logger");
  log.error("Failed to start worker service", error instanceof Error ? error : new Error(String(error)), {
    context: "worker.main",
  });
  process.exit(1);
});

