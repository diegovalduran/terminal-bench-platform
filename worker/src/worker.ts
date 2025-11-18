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

import dotenv from "dotenv";
import { resolve } from "path";
import { db } from "../../shared/db/client.js";
import { jobs } from "../../shared/db/schema.js";
import { eq } from "drizzle-orm";
import { jobQueue } from "../../shared/lib/job-queue.js";
import { validateStartup } from "../../shared/lib/startup-validation.js";
import { log } from "../../shared/lib/logger.js";
import { QueuedJob } from "../../shared/types/runs.js";

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

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
  if (!db) {
    log.error(new Error("Database not initialized"), {
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
      return; // No jobs to process
    }

    log.info(`Found ${queuedJobs.length} queued job(s)`, {
      context: "worker.processQueuedJobs",
    });

    // Enqueue each job
    for (const job of queuedJobs) {
      // Skip if already in queue or processing
      const queueStatus = jobQueue.getStatus();
      const isAlreadyProcessing =
        queueStatus.activeByUser[job.ownerId || ""] === job.id;

      if (isAlreadyProcessing) {
        log.debug(`Job ${job.id} already processing, skipping`, {
          context: "worker.processQueuedJobs",
        });
        continue;
      }

      // Check user queue status before enqueueing
      if (job.ownerId) {
        const userQueueStatus = jobQueue.getUserQueueStatus(job.ownerId);
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

        log.info(`Enqueued job ${job.id} (${job.taskName})`, {
          context: "worker.processQueuedJobs",
          jobId: job.id,
          taskName: job.taskName,
        });
      } catch (error) {
        log.error(
          error instanceof Error ? error : new Error(String(error)),
          {
            context: "worker.processQueuedJobs",
            jobId: job.id,
            message: "Failed to enqueue job",
          }
        );
      }
    }
  } catch (error) {
    log.error(
      error instanceof Error ? error : new Error(String(error)),
      {
        context: "worker.processQueuedJobs",
        message: "Error fetching queued jobs from database",
      }
    );
  }
}

/**
 * Start polling for queued jobs
 */
function startPolling() {
  if (pollInterval) {
    return; // Already polling
  }

  log.info(`Starting worker with poll interval: ${POLL_INTERVAL_MS}ms`, {
    context: "worker.startPolling",
  });

  // Process immediately on start
  processQueuedJobs();

  // Then poll periodically
  pollInterval = setInterval(() => {
    if (!isShuttingDown) {
      processQueuedJobs();
    }
  }, POLL_INTERVAL_MS);
}

/**
 * Stop polling and handle graceful shutdown
 */
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
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
  log.info(`Received ${signal}, initiating graceful shutdown...`, {
    context: "worker.gracefulShutdown",
  });

  // Stop polling
  stopPolling();

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
  log.info("Starting Terminal-Bench Worker Service...", {
    context: "worker.main",
  });

  // Validate environment
  validateStartup();

  // Check database connection
  if (!db) {
    log.error(
      new Error("Database not initialized. Check DATABASE_URL environment variable."),
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
      error instanceof Error ? error : new Error(String(error)),
      {
        context: "worker.main",
        message: "Database connection test failed",
      }
    );
    process.exit(1);
  }

  // Register signal handlers for graceful shutdown
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    log.error(error, {
      context: "worker.uncaughtException",
      message: "Uncaught exception, shutting down",
    });
    gracefulShutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason, promise) => {
    log.error(
      reason instanceof Error ? reason : new Error(String(reason)),
      {
        context: "worker.unhandledRejection",
        message: "Unhandled promise rejection",
      }
    );
  });

  // Start polling for queued jobs
  startPolling();

  log.info("Worker service started successfully", {
    context: "worker.main",
    pollInterval: POLL_INTERVAL_MS,
  });
}

// Run main function
main().catch((error) => {
  log.error(error instanceof Error ? error : new Error(String(error)), {
    context: "worker.main",
    message: "Failed to start worker service",
  });
  process.exit(1);
});

