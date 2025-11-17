import { spawn, ChildProcess } from "child_process";
import { mkdir, readFile, rm, readdir, stat } from "fs/promises";
import { join } from "path";
import extract from "extract-zip";
import { QueuedJob } from "./job-queue";
import { updateJobStatus, incrementJobProgress } from "./job-service";
import { createAttempt, updateAttempt, createEpisode } from "./attempt-service";

// Process registry for tracking and cancelling jobs
interface RunningJob {
  jobId: string;
  process: ChildProcess | null;
  cancelled: boolean;
}

const runningJobs = new Map<string, RunningJob>();

export function cancelJob(jobId: string): boolean {
  const job = runningJobs.get(jobId);
  if (!job) {
    console.log(`[Worker] Job ${jobId} not found in running jobs`);
    return false;
  }

  console.log(`[Worker] Cancelling job ${jobId}...`);
  job.cancelled = true;

  if (job.process && !job.process.killed) {
    // Kill the process and all its children
    try {
      process.kill(-job.process.pid!, "SIGTERM");
      console.log(`[Worker] Sent SIGTERM to process group ${job.process.pid}`);
    } catch (error) {
      console.error(`[Worker] Error killing process:`, error);
      // Try direct kill as fallback
      job.process.kill("SIGKILL");
    }
  }

  return true;
}

function isJobCancelled(jobId: string): boolean {
  return runningJobs.get(jobId)?.cancelled ?? false;
}

function runHarborCommand(
  command: string,
  args: string[],
  jobId: string,
  options: { cwd: string; timeout: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true, // Create new process group for easier killing
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Update running job with process reference
    const runningJob = runningJobs.get(jobId);
    if (runningJob) {
      runningJob.process = child;
    }

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        child.kill("SIGKILL");
      }
      reject(new Error(`Harbor command timed out after ${options.timeout}ms`));
    }, options.timeout);

    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        reject(new Error('Job cancelled'));
      } else if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Harbor exited with code ${code}\nStderr: ${stderr}`));
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

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

interface TrajectoryStep {
  observation?: string;
  thought?: string;
  action?: string;
  command?: string;
  output?: string;
  exit_code?: number;
}

interface Trajectory {
  steps?: TrajectoryStep[];
  observations?: Array<{
    state: string;
    timestamp: string;
  }>;
  actions?: Array<{
    command: string;
    output: string;
    exit_code?: number;
  }>;
}

async function parseTrajectory(trialDir: string): Promise<{
  episodes: Array<{
    stateAnalysis: string;
    explanation: string;
    commands: Array<{ command: string; output: string; exitCode?: number }>;
  }>;
  totalDurationMs: number;
}> {
  const trajectoryPath = join(trialDir, "agent", "trajectory.json");
  
  try {
    const trajectoryContent = await readFile(trajectoryPath, "utf-8");
    const trajectory: Trajectory = JSON.parse(trajectoryContent);
    
    const episodes: Array<{
      stateAnalysis: string;
      explanation: string;
      commands: Array<{ command: string; output: string; exitCode?: number }>;
    }> = [];
    
    // Parse steps-based trajectory (common format)
    if (trajectory.steps && Array.isArray(trajectory.steps)) {
      for (const step of trajectory.steps) {
        const commands: Array<{ command: string; output: string; exitCode?: number }> = [];
        
        if (step.command) {
          commands.push({
            command: step.command,
            output: step.output || "",
            exitCode: step.exit_code,
          });
        }
        
        episodes.push({
          stateAnalysis: step.observation || "No observation recorded",
          explanation: step.thought || step.action || "Agent action",
          commands,
        });
      }
    }
    // Parse action-based trajectory (alternative format)
    else if (trajectory.actions && Array.isArray(trajectory.actions)) {
      for (const action of trajectory.actions) {
        episodes.push({
          stateAnalysis: "Command execution",
          explanation: `Executed: ${action.command}`,
          commands: [{
            command: action.command,
            output: action.output || "",
            exitCode: action.exit_code,
          }],
        });
      }
    }
    
    return {
      episodes: episodes.length > 0 ? episodes : [{
        stateAnalysis: "No detailed trajectory available",
        explanation: "Agent completed execution",
        commands: [],
      }],
      totalDurationMs: 0,
    };
  } catch (error) {
    console.error(`[Worker] Failed to parse trajectory:`, error);
    // Return fallback episode if trajectory parsing fails
    return {
      episodes: [{
        stateAnalysis: "Trajectory parsing failed",
        explanation: "Could not extract detailed agent actions",
        commands: [],
      }],
      totalDurationMs: 0,
    };
  }
}

async function findTaskDirectory(baseDir: string): Promise<string> {
  // Check if task.toml exists at the base level
  const baseTomlPath = join(baseDir, "task.toml");
  const hasBaseToml = await readFile(baseTomlPath, "utf-8").catch(() => null);
  
  if (hasBaseToml) {
    return baseDir;
  }
  
  // Search one level deep for task.toml
  const entries = await readdir(baseDir);
  for (const entry of entries) {
    const entryPath = join(baseDir, entry);
    const stats = await stat(entryPath).catch(() => null);
    
    if (stats?.isDirectory()) {
      const subTomlPath = join(entryPath, "task.toml");
      const hasSubToml = await readFile(subTomlPath, "utf-8").catch(() => null);
      
      if (hasSubToml) {
        return entryPath;
      }
    }
  }
  
  throw new Error("Could not find task.toml in the extracted archive. Please ensure the zip contains a valid Terminal-Bench task.");
}

async function findLatestHarborOutput(outputDir: string): Promise<string> {
  const allEntries = await readdir(outputDir);
  const runDirs: string[] = [];
  
  for (const name of allEntries) {
    const entryPath = join(outputDir, name);
    const stats = await stat(entryPath).catch(() => null);
    if (stats?.isDirectory()) {
      runDirs.push(name);
    }
  }
  
  if (runDirs.length === 0) {
    throw new Error("Harbor did not create an output directory. Check that Harbor ran successfully.");
  }
  
  // Sort by timestamp (Harbor uses timestamped directories)
  runDirs.sort().reverse();
  return join(outputDir, runDirs[0]);
}

async function findTrialDirectory(runDir: string): Promise<string> {
  const entries = await readdir(runDir);
  const trialDirs: string[] = [];
  
  for (const name of entries) {
    const entryPath = join(runDir, name);
    const stats = await stat(entryPath).catch(() => null);
    if (stats?.isDirectory()) {
      trialDirs.push(name);
    }
  }
  
  if (trialDirs.length === 0) {
    throw new Error("No trial directory found in Harbor output");
  }
  
  // Harbor typically creates one trial directory per run
  return join(runDir, trialDirs[0]);
}

export async function processJob(job: QueuedJob) {
  console.log(`[Worker] Starting job ${job.jobId} - ${job.taskName}`);
  
  // Register job for cancellation tracking
  runningJobs.set(job.jobId, {
    jobId: job.jobId,
    process: null,
    cancelled: false,
  });
  
  const workDir = join(process.cwd(), "work", job.jobId);
  const taskDir = join(workDir, "task");
  const outputDir = join(workDir, "harbor-runs");
  
  try {
    await updateJobStatus(job.jobId, "running");
    
    // Check for cancellation before starting
    if (isJobCancelled(job.jobId)) {
      throw new Error("Job cancelled before starting");
    }
    
    // Create working directories
    await mkdir(workDir, { recursive: true });
    await mkdir(taskDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    
    console.log(`[Worker] Extracting ${job.zipPath} to ${taskDir}`);
    await extract(job.zipPath, { dir: taskDir });
    
    // Find the actual task directory
    const actualTaskDir = await findTaskDirectory(taskDir);
    console.log(`[Worker] Found task directory: ${actualTaskDir}`);
    
    // Run Harbor for each attempt
    for (let i = 0; i < job.runsRequested; i++) {
      // Check for cancellation before each attempt
      if (isJobCancelled(job.jobId)) {
        console.log(`[Worker] Job ${job.jobId} cancelled, stopping attempts`);
        throw new Error("Job cancelled");
      }
      
      console.log(`[Worker] Job ${job.jobId} - Attempt ${i + 1}/${job.runsRequested}`);
      
      const attempt = await createAttempt({
        jobId: job.jobId,
        index: i,
        status: "running",
      });
      
      const attemptStartTime = Date.now();
      
      try {
        const attemptOutputDir = join(outputDir, `attempt-${i}`);
        await mkdir(attemptOutputDir, { recursive: true });
        
        // Determine which agent to use based on environment
        const useTerminus2 = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 0;
        const harborArgs = [
          'run',
          '--path', actualTaskDir,
          '--agent', useTerminus2 ? 'terminus-2' : 'oracle',
          ...(useTerminus2 ? ['--model', 'gpt-5'] : []),
          '--env', 'docker',
          '--jobs-dir', attemptOutputDir,
          '--n-concurrent', '1',
        ];
        
        console.log(`[Worker] Running Harbor with ${useTerminus2 ? 'Terminus 2 (GPT-5)' : 'Oracle agent'}`);
        
        const { stdout, stderr } = await runHarborCommand(
          'harbor',
          harborArgs,
          job.jobId,
          {
            cwd: process.cwd(),
            timeout: 15 * 60 * 1000, // 15 minutes
          }
        );
        
        console.log(`[Worker] Harbor stdout:`, stdout.slice(0, 500));
        if (stderr) console.log(`[Worker] Harbor stderr:`, stderr.slice(0, 500));
        
        // Parse Harbor output using helper functions
        const latestRunDir = await findLatestHarborOutput(attemptOutputDir);
        console.log(`[Worker] Latest run dir: ${latestRunDir}`);
        
        const trialDir = await findTrialDirectory(latestRunDir);
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
        
        // Parse trajectory for detailed episodes
        const { episodes } = await parseTrajectory(trialDir);
        console.log(`[Worker] Parsed ${episodes.length} episodes from trajectory`);
        
        // Create episodes in database
        for (let episodeIdx = 0; episodeIdx < episodes.length; episodeIdx++) {
          const episode = episodes[episodeIdx];
          await createEpisode({
            attemptId: attempt.id,
            index: episodeIdx,
            stateAnalysis: episode.stateAnalysis,
            explanation: episode.explanation,
            commands: episode.commands,
            durationMs: undefined, // Could be calculated per-episode if timestamps available
          });
        }
        
        // Calculate attempt duration
        const attemptDuration = Date.now() - attemptStartTime;
        const attemptStatus = testsPassed === testsTotal ? "success" : "failed";
        
        // Update attempt with results
        await updateAttempt(attempt.id, {
          status: attemptStatus,
          testsPassed,
          testsTotal,
          rewardSummary: rewards,
          finishedAt: new Date(),
        });
        
        // Increment job progress
        await incrementJobProgress(job.jobId);
        
        console.log(
          `[Worker] Attempt ${i + 1} ${attemptStatus}: ${testsPassed}/${testsTotal} tests passed (${(attemptDuration / 1000).toFixed(1)}s)`
        );
      } catch (error) {
        const attemptDuration = Date.now() - attemptStartTime;
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        
        console.error(`[Worker] Attempt ${i + 1} failed after ${(attemptDuration / 1000).toFixed(1)}s:`, errorMessage);
        
        // Update attempt with failure status
        await updateAttempt(attempt.id, {
          status: "failed",
          finishedAt: new Date(),
        });
        
        // Create a fallback episode explaining the error
        await createEpisode({
          attemptId: attempt.id,
          index: 0,
          stateAnalysis: "Attempt failed during execution",
          explanation: `Error: ${errorMessage}`,
          commands: [],
        });
        
        // Continue with next attempt (don't fail entire job)
        console.log(`[Worker] Continuing with next attempt...`);
      }
    }
    
    // Job completed - update status
    await updateJobStatus(job.jobId, "completed");
    console.log(`[Worker] ✅ Job ${job.jobId} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Check if job was cancelled
    if (isJobCancelled(job.jobId) || errorMessage.includes("cancelled")) {
      console.log(`[Worker] 🛑 Job ${job.jobId} cancelled`);
      await updateJobStatus(job.jobId, "failed", "Job cancelled by user");
    } else {
      console.error(`[Worker] ❌ Job ${job.jobId} failed:`, errorMessage);
      await updateJobStatus(job.jobId, "failed", errorMessage);
    }
    
    // Don't re-throw - let the queue continue processing other jobs
  } finally {
    // Unregister job from running jobs
    runningJobs.delete(job.jobId);
    console.log(`[Worker] Unregistered job ${job.jobId}`);
    
    // Cleanup work directory and uploaded zip
    try {
      // Remove work directory
      await rm(workDir, { recursive: true, force: true });
      console.log(`[Worker] Cleaned up work directory: ${workDir}`);
      
      // Remove uploaded zip file
      await rm(job.zipPath, { force: true });
      console.log(`[Worker] Cleaned up uploaded file: ${job.zipPath}`);
    } catch (cleanupError) {
      console.error(`[Worker] Failed to cleanup files:`, cleanupError);
      // Don't fail the job because of cleanup errors
    }
  }
}
