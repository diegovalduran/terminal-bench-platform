import { QueuedJob } from "./job-queue";
import { updateJobStatus } from "./job-service";

export async function processJob(job: QueuedJob) {
  console.log(`[Worker] Starting job ${job.jobId}`);
  
  try {
    await updateJobStatus(job.jobId, "running");
    
    // TODO: Implement actual Harbor execution in next milestone
    // For now, just simulate processing
    console.log(`[Worker] Job ${job.jobId} - Would run Harbor ${job.runsRequested} times`);
    console.log(`[Worker] Job ${job.jobId} - Zip path: ${job.zipPath}`);
    
    // Simulate work
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    await updateJobStatus(job.jobId, "completed");
    console.log(`[Worker] Completed job ${job.jobId}`);
  } catch (error) {
    console.error(`[Worker] Error processing job ${job.jobId}:`, error);
    await updateJobStatus(
      job.jobId,
      "failed",
      error instanceof Error ? error.message : "Unknown error"
    );
    throw error;
  }
}

