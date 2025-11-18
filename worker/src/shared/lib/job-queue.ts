import { QueuedJob } from "../types/runs.js";

class JobQueue {
  private queue: QueuedJob[] = [];
  private running = new Set<string>();
  private activeJobsByUser = new Map<string, string>(); // userId -> jobId
  private queuedJobsByUser = new Map<string, QueuedJob[]>(); // userId -> jobs[]
  private maxConcurrent: number;
  private maxQueuedPerUser: number;

  constructor(maxConcurrent = 5, maxQueuedPerUser = 5) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueuedPerUser = maxQueuedPerUser;
  }

  enqueue(job: QueuedJob) {
    // Check if user already has an active job
    if (this.activeJobsByUser.has(job.userId)) {
      // User has active job, add to their queue
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
      
      console.log(
        `[Queue] User ${job.userId.slice(0, 8)}... has active job, queued ${job.taskName} (${userQueue.length}/${this.maxQueuedPerUser} queued)`
      );
      return;
    }
    
    // User has no active job, can start immediately if slot available
    if (this.running.size < this.maxConcurrent) {
      // Start immediately
      this.activeJobsByUser.set(job.userId, job.jobId);
      this.processJob(job);
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      process.stdout.write(`\n🚀 [${timestamp}] [Queue] Enqueued job ${job.jobId.slice(0, 8)}... for user ${job.userId.slice(0, 8)}... - Running: ${this.running.size + 1}/${this.maxConcurrent}\n`);
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
      // Find next job from a user who doesn't have an active job
      const jobIndex = this.queue.findIndex(
        (job) => !this.activeJobsByUser.has(job.userId)
      );

      if (jobIndex === -1) {
        // All users in queue already have active jobs
        break;
      }

      const job = this.queue.splice(jobIndex, 1)[0];
      if (!job) break;

      // Mark user as having active job
      this.activeJobsByUser.set(job.userId, job.jobId);

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
      this.activeJobsByUser.delete(job.userId);
      
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
        this.activeJobsByUser.set(nextJob.userId, nextJob.jobId);
        this.processJob(nextJob);
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        process.stdout.write(`\n➡️ [${timestamp}] [Queue] Started next job for user ${nextJob.userId.slice(0, 8)}... (${userQueue.length} remaining in queue)\n`);
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

    // Get active jobs per user
    const activeByUser: Record<string, string> = {};
    this.activeJobsByUser.forEach((jobId, userId) => {
      activeByUser[userId] = jobId;
    });

    return {
      queued: this.queue.length,
      running: this.running.size,
      maxConcurrent: this.maxConcurrent,
      available: this.maxConcurrent - this.running.size,
      activeUsers: this.activeJobsByUser.size,
      queuedByUser,
      activeByUser,
    };
  }

  getUserQueueStatus(userId: string) {
    const hasActiveJob = this.activeJobsByUser.has(userId);
    const queuedJobs = this.queuedJobsByUser.get(userId) || [];
    const activeJobId = this.activeJobsByUser.get(userId);

    // Count jobs in main queue that belong to this user (waiting for system slots)
    const jobsInMainQueue = this.queue.filter((job) => job.userId === userId).length;

    // Total queued jobs = user's personal queue + jobs in main queue
    const totalQueued = queuedJobs.length + jobsInMainQueue;

    return {
      hasActiveJob,
      activeJobId: activeJobId || null,
      queuedCount: totalQueued,
      maxQueued: this.maxQueuedPerUser,
      canQueueMore: totalQueued < this.maxQueuedPerUser,
    };
  }
}

// Singleton instance
export const jobQueue = new JobQueue();

