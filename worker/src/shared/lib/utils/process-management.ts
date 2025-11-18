import { ChildProcess } from "child_process";
import { exec } from "child_process";
import { promisify } from "util";
import { updateAttempt } from "../attempt-service.js";

const execAsync = promisify(exec);

// Process registry for tracking and cancelling jobs
export interface RunningJob {
  jobId: string;
  taskName: string; // Task name for Docker container filtering
  processes: Set<ChildProcess>; // Track all concurrent processes
  attemptIds: Set<string>; // Track all attempt IDs for cleanup
  cancelled: boolean;
}

const runningJobs = new Map<string, RunningJob>();

/**
 * Get the running jobs registry (for internal use)
 */
export function getRunningJobs(): Map<string, RunningJob> {
  return runningJobs;
}

/**
 * Register a job for cancellation tracking
 */
export function registerJob(jobId: string, taskName: string): void {
  runningJobs.set(jobId, {
    jobId,
    taskName,
    processes: new Set<ChildProcess>(),
    attemptIds: new Set<string>(),
    cancelled: false,
  });
}

/**
 * Get a running job
 */
export function getRunningJob(jobId: string): RunningJob | undefined {
  return runningJobs.get(jobId);
}

/**
 * Unregister a job (cleanup after completion)
 */
export function unregisterJob(jobId: string): void {
  runningJobs.delete(jobId);
}

/**
 * Add a process to a job's process set
 */
export function addProcessToJob(jobId: string, process: ChildProcess): void {
  const job = runningJobs.get(jobId);
  if (job) {
    job.processes.add(process);
    // Remove process from set when it exits
    process.on('exit', () => {
      job.processes.delete(process);
    });
  }
}

/**
 * Add an attempt ID to a job's attempt set
 */
export function addAttemptToJob(jobId: string, attemptId: string): void {
  const job = runningJobs.get(jobId);
  if (job) {
    job.attemptIds.add(attemptId);
  }
}

/**
 * Find and kill Docker containers for a specific job
 * Uses a simple but safe approach: only clean up containers when we have active processes
 * AND the container name matches the task. This is safe because:
 * 1. We only run this during cancellation (when processes are still tracked)
 * 2. Other users' jobs won't have their processes in our runningJobs map
 * 3. Task name filter ensures we don't touch other tasks
 * 
 * Note: When we kill the Harbor process group, most containers should be cleaned up automatically.
 * This function handles any orphaned containers that remain.
 */
export async function killDockerContainers(jobId: string, taskName: string): Promise<number> {
  const job = runningJobs.get(jobId);
  
  // Only clean up containers if we have active processes for this job
  // This ensures we don't touch containers from other users' jobs
  if (!job || job.processes.size === 0) {
    return 0;
  }
  
  let killedCount = 0;
  
  try {
    // Find all running Docker containers matching our task name
    // Harbor creates containers with names like: "task-name__hash-main-1"
    const { stdout } = await execAsync("docker ps --format '{{.ID}} {{.Names}}'");
    
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      
      const containerId = parts[0];
      const containerName = parts.slice(1).join(' ');
      
      // Only match containers for this specific task
      // Since we only run this when we have active processes for this job,
      // and other users' jobs won't have processes in our map, this is safe
      if (containerName && containerName.startsWith(`${taskName}__`)) {
        try {
          // Use docker rm -f which kills AND removes the container in one command
          await execAsync(`docker rm -f ${containerId}`);
          process.stdout.write(`  → Killed and removed Docker container ${containerId} (${containerName})\n`);
          killedCount++;
        } catch (error) {
          // If rm -f fails, try kill then rm separately
          try {
            await execAsync(`docker kill ${containerId}`);
            await execAsync(`docker rm ${containerId}`);
            process.stdout.write(`  → Killed and removed Docker container ${containerId} (${containerName})\n`);
            killedCount++;
          } catch (rmError) {
            // Ignore errors - container might not exist or already be removed
          }
        }
      }
    }
  } catch (error) {
    // If docker ps fails, docker might not be available - ignore
  }
  
  return killedCount;
}

/**
 * Cancel a running job
 */
export async function cancelJob(jobId: string): Promise<boolean> {
  const job = runningJobs.get(jobId);
  if (!job) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    process.stdout.write(`\n⚠️ [${timestamp}] [Worker] Job ${jobId.slice(0, 8)}... not found in running jobs\n`);
    return false;
  }

  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  process.stdout.write(`\n🛑 [${timestamp}] [Worker] Cancelling job ${jobId.slice(0, 8)}...\n`);
  job.cancelled = true;

  // Kill all processes for this job - use aggressive termination
  let killedCount = 0;
  for (const childProcess of job.processes) {
    if (!childProcess.killed && childProcess.pid) {
      try {
        // First try SIGTERM (graceful shutdown)
        // @ts-ignore - process.kill supports negative PID for process groups
        process.kill(-childProcess.pid, "SIGTERM");
        process.stdout.write(`  → Sent SIGTERM to process group ${childProcess.pid}\n`);
        killedCount++;
        
        // Wait a short time, then force kill if still running
        setTimeout(() => {
          try {
            if (!childProcess.killed && childProcess.pid) {
              // @ts-ignore
              process.kill(-childProcess.pid, "SIGKILL");
              process.stdout.write(`  → Force killed process group ${childProcess.pid}\n`);
            }
          } catch (error) {
            // Ignore errors - process might already be dead
          }
        }, 2000); // 2 second grace period
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        process.stdout.write(`  ⚠️ Error killing process ${childProcess.pid}: ${errorMsg}\n`);
        // Try direct SIGKILL as fallback
        try {
          childProcess.kill("SIGKILL");
        } catch (killError) {
          // Ignore errors
        }
      }
    }
  }
  
  // Kill Docker containers that might be orphaned (only for this specific job)
  process.stdout.write(`  → Cleaning up Docker containers for task "${job.taskName}"...\n`);
  const dockerKilled = await killDockerContainers(jobId, job.taskName);
  if (dockerKilled > 0) {
    process.stdout.write(`  → Killed ${dockerKilled} Docker container(s)\n`);
  }

  // Update all running attempts to failed status
  let updatedAttempts = 0;
  for (const attemptId of job.attemptIds) {
    try {
      await updateAttempt(attemptId, {
        status: "failed",
        finishedAt: new Date(),
      });
      updatedAttempts++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      process.stdout.write(`  ⚠️ Error updating attempt ${attemptId}: ${errorMsg}\n`);
    }
  }

  process.stdout.write(`\n✅ [${timestamp}] [Worker] Cancelled ${killedCount} process(es), ${dockerKilled} Docker container(s), and updated ${updatedAttempts} attempt(s) for job ${jobId.slice(0, 8)}...\n`);
  return true;
}

/**
 * Check if a job has been cancelled
 */
export async function isJobCancelled(jobId: string): Promise<boolean> {
  // Check in-memory flag first (fast)
  const inMemoryCancelled = runningJobs.get(jobId)?.cancelled ?? false;
  if (inMemoryCancelled) {
    return true;
  }
  
  // Check database status (in case frontend API cancelled it)
  try {
    const { db } = await import("../../db/client.js");
    const { jobs } = await import("../../db/schema.js");
    const { eq } = await import("drizzle-orm");
    
    if (!db) {
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      process.stdout.write(`\n⚠️ [${timestamp}] [Worker] Cannot check cancellation for job ${jobId.slice(0, 8)}...: DB not available\n`);
      return false;
    }
    
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    
    // Job is considered cancelled if it's marked as "failed" with a cancellation message
    // or if it no longer exists in the database
    if (!job) {
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      process.stdout.write(`\n⚠️ [${timestamp}] [Worker] Job ${jobId.slice(0, 8)}... not found in database, treating as cancelled\n`);
      return true;
    }
    
    if (job.status === "failed" && job.errorMessage?.includes("cancelled")) {
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      process.stdout.write(`\n🛑 [${timestamp}] [Worker] Job ${jobId.slice(0, 8)}... was cancelled via API\n`);
      // Update in-memory flag and kill processes
      const runningJob = runningJobs.get(jobId);
      if (runningJob) {
        runningJob.cancelled = true;
        
        // Kill all running processes for this job
        if (runningJob.processes.size > 0) {
          process.stdout.write(`  → Killing ${runningJob.processes.size} running process(es)...\n`);
          for (const childProcess of runningJob.processes) {
            if (!childProcess.killed && childProcess.pid) {
              try {
                // @ts-ignore - process.kill supports negative PID for process groups
                process.kill(-childProcess.pid, "SIGTERM");
                // Also force kill after short delay
                setTimeout(() => {
                  try {
                    if (!childProcess.killed && childProcess.pid) {
                      // @ts-ignore
                      process.kill(-childProcess.pid, "SIGKILL");
                    }
                  } catch (error) {
                    // Ignore errors
                  }
                }, 2000);
              } catch (error) {
                // Ignore errors, process might already be dead
              }
            }
          }
          
          // Also kill Docker containers (only for this specific job)
          if (runningJob.taskName) {
            killDockerContainers(jobId, runningJob.taskName).then(count => {
              if (count > 0) {
                process.stdout.write(`  → Killed ${count} Docker container(s) for task "${runningJob.taskName}"\n`);
              }
            }).catch(() => {
              // Ignore errors
            });
          }
        }
      }
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`[Worker] Error checking cancellation status for job ${jobId}:`, error);
    return false; // Don't cancel on error, let the job continue
  }
}

