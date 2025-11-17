import { exec } from "child_process";
import { promisify } from "util";
import { mkdir, readFile, rm, readdir, stat } from "fs/promises";
import { join } from "path";
import extract from "extract-zip";
import { QueuedJob } from "./job-queue";
import { updateJobStatus, incrementJobProgress } from "./job-service";
import { createAttempt, updateAttempt, createEpisode } from "./attempt-service";

const execAsync = promisify(exec);

interface HarborTrialResult {
  agent_info: {
    name: string;
    model_info?: {
      name: string;
    };
  };
  verifier_result?: {
    rewards: Record<string, number>;
  };
  started_at: string;
  finished_at: string;
}

export async function processJob(job: QueuedJob) {
  console.log(`[Worker] Starting job ${job.jobId}`);
  
  const workDir = join(process.cwd(), "work", job.jobId);
  const taskDir = join(workDir, "task");
  const outputDir = join(workDir, "harbor-runs");
  
  try {
    await updateJobStatus(job.jobId, "running");
    
    // Create working directories
    await mkdir(workDir, { recursive: true });
    await mkdir(taskDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    
    console.log(`[Worker] Extracting ${job.zipPath} to ${taskDir}`);
    await extract(job.zipPath, { dir: taskDir });
    
    // Find the extracted task directory (might be nested)
    const extractedContents = await readFile(join(taskDir, "task.toml"), "utf-8").catch(() => null);
    let actualTaskDir = taskDir;
    
    if (!extractedContents) {
      // Task might be in a subdirectory
      const entries = await readdir(taskDir);
      for (const entry of entries) {
        const entryPath = join(taskDir, entry);
        const stats = await stat(entryPath);
        if (stats.isDirectory()) {
          const subEntries = await readdir(entryPath);
          const hasTaskToml = subEntries.includes("task.toml");
          if (hasTaskToml) {
            actualTaskDir = entryPath;
            break;
          }
        }
      }
    }
    
    console.log(`[Worker] Task directory: ${actualTaskDir}`);
    
    // Run Harbor for each attempt
    for (let i = 0; i < job.runsRequested; i++) {
      console.log(`[Worker] Job ${job.jobId} - Attempt ${i + 1}/${job.runsRequested}`);
      
      const attempt = await createAttempt({
        jobId: job.jobId,
        index: i,
        status: "running",
      });
      
      try {
        const attemptOutputDir = join(outputDir, `attempt-${i}`);
        await mkdir(attemptOutputDir, { recursive: true });
        
        // Run Harbor CLI
        // For now, use oracle agent to test the flow
        // TODO: Switch to terminus-2 with GPT-5 when API key is configured
        const harborCmd = `harbor run \
          --path "${actualTaskDir}" \
          --agent oracle \
          --env docker \
          --jobs-dir "${attemptOutputDir}" \
          --n-concurrent 1`;
        
        console.log(`[Worker] Running: ${harborCmd}`);
        
        const { stdout, stderr } = await execAsync(harborCmd, {
          cwd: process.cwd(),
          timeout: 15 * 60 * 1000, // 15 minutes
        });
        
        console.log(`[Worker] Harbor stdout:`, stdout.slice(0, 500));
        if (stderr) console.log(`[Worker] Harbor stderr:`, stderr.slice(0, 500));
        
        // Parse Harbor output
        // Harbor creates a timestamped directory, find it
        const allEntries = await readdir(attemptOutputDir);
        const runDirs = [];
        for (const name of allEntries) {
          const stats = await stat(join(attemptOutputDir, name));
          if (stats.isDirectory()) {
            runDirs.push(name);
          }
        }
        runDirs.sort().reverse();
        
        if (runDirs.length === 0) {
          throw new Error("No Harbor output directory found");
        }
        
        const latestRunDir = join(attemptOutputDir, runDirs[0]);
        console.log(`[Worker] Latest run dir: ${latestRunDir}`);
        
        // Find trial directory
        const allTrialEntries = await readdir(latestRunDir);
        const trialDirs = [];
        for (const name of allTrialEntries) {
          const stats = await stat(join(latestRunDir, name));
          if (stats.isDirectory()) {
            trialDirs.push(name);
          }
        }
        
        if (trialDirs.length === 0) {
          throw new Error("No trial directory found in Harbor output");
        }
        
        const trialDir = join(latestRunDir, trialDirs[0]);
        console.log(`[Worker] Trial dir: ${trialDir}`);
        
        // Parse result.json
        const resultPath = join(trialDir, "result.json");
        const resultContent = await readFile(resultPath, "utf-8");
        const result: HarborTrialResult = JSON.parse(resultContent);
        
        // Parse rewards
        const rewards = result.verifier_result?.rewards || {};
        const testsPassed = Object.values(rewards).filter((r) => r === 1).length;
        const testsTotal = Object.keys(rewards).length;
        
        console.log(`[Worker] Tests: ${testsPassed}/${testsTotal}`);
        
        // Parse trajectory for episodes (if available)
        // For now, create a single episode with summary info
        await createEpisode({
          attemptId: attempt.id,
          index: 0,
          stateAnalysis: `Task completed with ${testsPassed}/${testsTotal} tests passing`,
          explanation: `Agent: ${result.agent_info.name}`,
          commands: [],
          durationMs: new Date(result.finished_at).getTime() - new Date(result.started_at).getTime(),
        });
        
        // Update attempt
        await updateAttempt(attempt.id, {
          status: testsPassed === testsTotal ? "success" : "failed",
          testsPassed,
          testsTotal,
          rewardSummary: rewards,
          finishedAt: new Date(),
        });
        
        // Increment job progress
        await incrementJobProgress(job.jobId);
        
        console.log(`[Worker] Completed attempt ${i + 1}`);
      } catch (error) {
        console.error(`[Worker] Attempt ${i + 1} failed:`, error);
        await updateAttempt(attempt.id, {
          status: "failed",
          finishedAt: new Date(),
        });
        // Continue with next attempt
      }
    }
    
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
  } finally {
    // Cleanup work directory
    try {
      await rm(workDir, { recursive: true, force: true });
      console.log(`[Worker] Cleaned up ${workDir}`);
    } catch (cleanupError) {
      console.error(`[Worker] Failed to cleanup ${workDir}:`, cleanupError);
    }
  }
}
