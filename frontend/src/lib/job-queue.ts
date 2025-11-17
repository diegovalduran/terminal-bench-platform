export interface QueuedJob {
  jobId: string;
  taskName: string;
  zipPath: string;
  runsRequested: number;
}

class JobQueue {
  private queue: QueuedJob[] = [];
  private processing = false;

  enqueue(job: QueuedJob) {
    this.queue.push(job);
    console.log(`[Queue] Enqueued job ${job.jobId}, queue length: ${this.queue.length}`);
    
    // Auto-process if not already processing
    if (!this.processing) {
      this.processNext();
    }
  }

  private async processNext() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const job = this.queue.shift();
    
    if (!job) {
      this.processing = false;
      return;
    }

    console.log(`[Queue] Processing job ${job.jobId}`);
    
    try {
      // Import worker dynamically to avoid circular deps
      const { processJob } = await import("./job-worker");
      await processJob(job);
      console.log(`[Queue] Completed job ${job.jobId}`);
    } catch (error) {
      console.error(`[Queue] Failed to process job ${job.jobId}:`, error);
    }

    // Process next job
    this.processNext();
  }

  getQueueLength() {
    return this.queue.length;
  }

  isProcessing() {
    return this.processing;
  }
}

// Singleton instance
export const jobQueue = new JobQueue();

