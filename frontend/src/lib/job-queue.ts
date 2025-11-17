export interface QueuedJob {
  jobId: string;
  taskName: string;
  zipPath: string;
  runsRequested: number;
}

class JobQueue {
  private queue: QueuedJob[] = [];
  private running = new Set<string>();
  private maxConcurrent: number;

  constructor(maxConcurrent = 5) {
    this.maxConcurrent = maxConcurrent;
  }

  enqueue(job: QueuedJob) {
    this.queue.push(job);
    console.log(
      `[Queue] Enqueued job ${job.jobId.slice(0, 8)}... (${job.taskName}) - Queue: ${this.queue.length}, Running: ${this.running.size}/${this.maxConcurrent}`
    );
    
    // Try to start processing immediately
    this.processAvailable();
  }

  private async processAvailable() {
    // Start as many jobs as we have slots for
    while (this.queue.length > 0 && this.running.size < this.maxConcurrent) {
      const job = this.queue.shift();
      if (!job) break;

      // Start job processing (don't await - let it run concurrently)
      this.processJob(job);
    }
  }

  private async processJob(job: QueuedJob) {
    this.running.add(job.jobId);
    console.log(
      `[Queue] Starting job ${job.jobId.slice(0, 8)}... - Running: ${this.running.size}/${this.maxConcurrent}`
    );

    try {
      // Import worker dynamically to avoid circular deps
      const { processJob: executeJob } = await import("./job-worker");
      await executeJob(job);
      console.log(
        `[Queue] ✅ Completed job ${job.jobId.slice(0, 8)}... - Running: ${this.running.size - 1}/${this.maxConcurrent}`
      );
    } catch (error) {
      console.error(
        `[Queue] ❌ Failed job ${job.jobId.slice(0, 8)}...:`,
        error instanceof Error ? error.message : error
      );
    } finally {
      // Remove from running set and try to process next
      this.running.delete(job.jobId);
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
    return {
      queued: this.queue.length,
      running: this.running.size,
      maxConcurrent: this.maxConcurrent,
      available: this.maxConcurrent - this.running.size,
    };
  }
}

// Singleton instance
export const jobQueue = new JobQueue();

