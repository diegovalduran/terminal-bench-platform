import { QueuedJob } from "../types/runs.js";

class JobQueue {
  private queue: QueuedJob[] = [];
  private running = new Set<string>();
  private activeJobsByUser = new Map<string, Set<string>>(); // userId -> Set<jobId>
  private queuedJobsByUser = new Map<string, QueuedJob[]>(); // userId -> jobs[]
  private maxConcurrent: number;
  private maxQueuedPerUser: number;
  private maxActivePerUser: number;

  constructor(maxConcurrent = 5, maxQueuedPerUser = 5, maxActivePerUser = 5) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueuedPerUser = maxQueuedPerUser;
    this.maxActivePerUser = maxActivePerUser;
  }

  enqueue(job: QueuedJob) {
    const userActiveJobs = this.activeJobsByUser.get(job.userId) || new Set<string>();
    const activeCount = userActiveJobs.size;
    
    // Check if user has reached max active jobs
    if (activeCount >= this.maxActivePerUser) {
      // User has max active jobs, add to their queue
      const userQueue = this.queuedJobsByUser.get(job.userId) || [];
      
      // Check queue limit per user
      if (userQueue.length >= this.maxQueuedPerUser) {
        throw new Error(
          `User has reached maximum queued jobs limit (${this.maxQueuedPerUser})`
        );
      }
      
      userQueue.push(job);
      this.queuedJobsByUser.set(job.userId, userQueue);
      this.queue.push(job);
      
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      process.stdout.write(`\n⏳ [${timestamp}] [Queue] User ${job.userId.slice(0, 8)}... has ${activeCount} active jobs, queued ${job.taskName} (${userQueue.length}/${this.maxQueuedPerUser} queued)\n`);
      return;
    }
    
    // User has capacity for more active jobs, can start immediately if slot available
    if (this.running.size < this.maxConcurrent) {
      // Start immediately
      if (!this.activeJobsByUser.has(job.userId)) {
        this.activeJobsByUser.set(job.userId, new Set<string>());
      }
      this.activeJobsByUser.get(job.userId)!.add(job.jobId);
      this.processJob(job);
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      process.stdout.write(`\n🚀 [${timestamp}] [Queue] Starting job ${job.jobId.slice(0, 8)}... for user ${job.userId.slice(0, 8)}... (${activeCount + 1}/${this.maxActivePerUser} active) - Running: ${this.running.size + 1}/${this.maxConcurrent}\n`);
    } else {
      // No slots available, add to queue
      this.queue.push(job);
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      process.stdout.write(`\n⏳ [${timestamp}] [Queue] Queued job ${job.jobId.slice(0, 8)}... (${job.taskName}) - Queue: ${this.queue.length}, Running: ${this.running.size}/${this.maxConcurrent}\n`);
    }
  }

  private async processAvailable() {
    // Start as many jobs as we have slots for, with fair scheduling
    while (this.queue.length > 0 && this.running.size < this.maxConcurrent) {
      // Find next job from a user who hasn't reached max active jobs
      const jobIndex = this.queue.findIndex((job) => {
        const userActiveJobs = this.activeJobsByUser.get(job.userId) || new Set<string>();
        return userActiveJobs.size < this.maxActivePerUser;
      });

      if (jobIndex === -1) {
        // All users in queue already have max active jobs
        break;
      }

      const job = this.queue.splice(jobIndex, 1)[0];
      if (!job) break;

      // Mark user as having this active job
      if (!this.activeJobsByUser.has(job.userId)) {
        this.activeJobsByUser.set(job.userId, new Set<string>());
      }
      this.activeJobsByUser.get(job.userId)!.add(job.jobId);

      // Start job processing (don't await - let it run concurrently)
      this.processJob(job);
    }
  }

  private async processJob(job: QueuedJob) {
    this.running.add(job.jobId);
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    process.stdout.write(`\n🔄 [${timestamp}] [Queue] Starting job ${job.jobId.slice(0, 8)}... - Running: ${this.running.size}/${this.maxConcurrent}\n`);

    try {
      // Import worker dynamically to avoid circular deps
      const { processJob: executeJob } = await import("./job-worker.js");
      await executeJob(job);
      const timestamp2 = new Date().toISOString().split('T')[1].split('.')[0];
      process.stdout.write(`\n✅ [${timestamp2}] [Queue] Completed job ${job.jobId.slice(0, 8)}... - Running: ${this.running.size - 1}/${this.maxConcurrent}\n`);
    } catch (error) {
      const timestamp3 = new Date().toISOString().split('T')[1].split('.')[0];
      const errorMsg = error instanceof Error ? error.message : String(error);
      process.stdout.write(`\n❌ [${timestamp3}] [Queue] Failed job ${job.jobId.slice(0, 8)}...: ${errorMsg}\n`);
    } finally {
      // Remove from running set
      this.running.delete(job.jobId);
      
      // Remove user's active job
      const userActiveJobs = this.activeJobsByUser.get(job.userId);
      if (userActiveJobs) {
        userActiveJobs.delete(job.jobId);
        if (userActiveJobs.size === 0) {
          this.activeJobsByUser.delete(job.userId);
        }
      }
      
      // Check if user has queued jobs and start the next one
      const userQueue = this.queuedJobsByUser.get(job.userId);
      if (userQueue && userQueue.length > 0) {
        const nextJob = userQueue.shift()!;
        this.queuedJobsByUser.set(job.userId, userQueue);
        
        // Remove from main queue if it's there
        const queueIndex = this.queue.findIndex((j) => j.jobId === nextJob.jobId);
        if (queueIndex !== -1) {
          this.queue.splice(queueIndex, 1);
        }
        
        // Start the next job for this user
        if (!this.activeJobsByUser.has(nextJob.userId)) {
          this.activeJobsByUser.set(nextJob.userId, new Set<string>());
        }
        this.activeJobsByUser.get(nextJob.userId)!.add(nextJob.jobId);
        this.processJob(nextJob);
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        const activeCount = this.activeJobsByUser.get(nextJob.userId)?.size || 0;
        process.stdout.write(`\n➡️ [${timestamp}] [Queue] Started next job for user ${nextJob.userId.slice(0, 8)}... (${activeCount}/${this.maxActivePerUser} active, ${userQueue.length} remaining in queue)\n`);
      }
      
      // Try to process other available jobs
      this.processAvailable();
    }
  }

  getQueueLength() {
    return this.queue.length;
  }

  getRunningCount() {
    return this.running.size;
  }

  getMaxConcurrent() {
    return this.maxConcurrent;
  }

  isProcessing() {
    return this.running.size > 0 || this.queue.length > 0;
  }

  getStatus() {
    // Count queued jobs per user
    const queuedByUser: Record<string, number> = {};
    this.queuedJobsByUser.forEach((jobs, userId) => {
      queuedByUser[userId] = jobs.length;
    });

    // Get active jobs per user (count and first job ID for compatibility)
    const activeByUser: Record<string, string> = {};
    const activeCountByUser: Record<string, number> = {};
    this.activeJobsByUser.forEach((jobIds, userId) => {
      activeCountByUser[userId] = jobIds.size;
      // For backward compatibility, store first job ID
      const firstJobId = Array.from(jobIds)[0];
      if (firstJobId) {
        activeByUser[userId] = firstJobId;
      }
    });

    return {
      queued: this.queue.length,
      running: this.running.size,
      maxConcurrent: this.maxConcurrent,
      available: this.maxConcurrent - this.running.size,
      activeUsers: this.activeJobsByUser.size,
      queuedByUser,
      activeByUser,
      activeCountByUser,
    };
  }

  getUserQueueStatus(userId: string) {
    const userActiveJobs = this.activeJobsByUser.get(userId) || new Set<string>();
    const activeCount = userActiveJobs.size;
    const queuedJobs = this.queuedJobsByUser.get(userId) || [];
    const activeJobIds = Array.from(userActiveJobs);

    // Count jobs in main queue that belong to this user (waiting for system slots)
    const jobsInMainQueue = this.queue.filter((job) => job.userId === userId).length;

    // Total queued jobs = user's personal queue + jobs in main queue
    const totalQueued = queuedJobs.length + jobsInMainQueue;

    return {
      hasActiveJob: activeCount > 0,
      activeJobCount: activeCount,
      maxActivePerUser: this.maxActivePerUser,
      activeJobIds: activeJobIds.length > 0 ? activeJobIds : null,
      queuedCount: totalQueued,
      maxQueued: this.maxQueuedPerUser,
      canQueueMore: activeCount < this.maxActivePerUser && totalQueued < this.maxQueuedPerUser,
    };
  }
}

// Singleton instance
export const jobQueue = new JobQueue();

