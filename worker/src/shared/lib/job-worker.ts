import { spawn, ChildProcess, exec } from "child_process";
import { promisify } from "util";
import { mkdir, readFile, readdir, stat, writeFile, unlink, rm } from "fs/promises";
import { join } from "path";
import extract from "extract-zip";

const execAsync = promisify(exec);
import { QueuedJob } from "../types/runs.js";
import { updateJobStatus, incrementJobProgress } from "./job-service.js";
import { createAttempt, updateAttempt, createEpisode } from "./attempt-service.js";
import { downloadFile, uploadDirectory } from "./s3-service.js";
import { Semaphore } from "./semaphore.js";

// Process registry for tracking and cancelling jobs
interface RunningJob {
  jobId: string;
  taskName: string; // Task name for Docker container filtering
  processes: Set<ChildProcess>; // Track all concurrent processes
  attemptIds: Set<string>; // Track all attempt IDs for cleanup
  cancelled: boolean;
}

const runningJobs = new Map<string, RunningJob>();

/**
 * Extract S3 key from S3 URL
 * @param s3Url - S3 URL in format "s3://bucket/key/path.zip"
 * @returns The key portion (e.g., "key/path.zip")
 */
function extractS3Key(s3Url: string): string {
  if (!s3Url.startsWith("s3://")) {
    throw new Error(`Invalid S3 URL format: ${s3Url}`);
  }
  
  // Remove "s3://" prefix and bucket name
  const withoutProtocol = s3Url.slice(5); // Remove "s3://"
  const firstSlashIndex = withoutProtocol.indexOf("/");
  
  if (firstSlashIndex === -1) {
    throw new Error(`Invalid S3 URL format: ${s3Url}`);
  }
  
  return withoutProtocol.slice(firstSlashIndex + 1);
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
async function killDockerContainers(jobId: string, taskName: string): Promise<number> {
  const runningJob = runningJobs.get(jobId);
  
  // Only clean up containers if we have active processes for this job
  // This ensures we don't touch containers from other users' jobs
  if (!runningJob || runningJob.processes.size === 0) {
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
  const { updateAttempt } = await import("./attempt-service.js");
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

async function isJobCancelled(jobId: string): Promise<boolean> {
  // Check in-memory flag first (fast)
  const inMemoryCancelled = runningJobs.get(jobId)?.cancelled ?? false;
  if (inMemoryCancelled) {
    return true;
  }
  
  // Check database status (in case frontend API cancelled it)
  try {
    const { db } = await import("../db/client.js");
    const { jobs } = await import("../db/schema.js");
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
      runningJob.processes.add(child);
      
      // Remove process from set when it exits
      child.on('exit', () => {
        runningJob.processes.delete(child);
      });
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

    // Periodic cancellation check during Harbor execution
    // This ensures cancellation is detected quickly (within ~2 seconds) instead of waiting for Harbor to finish
    const cancellationCheckInterval = setInterval(async () => {
      const cancelled = await isJobCancelled(jobId);
      if (cancelled) {
        clearInterval(cancellationCheckInterval);
        clearTimeout(timeout);
        
        // Kill the process immediately
        try {
          if (!child.killed && child.pid) {
            // @ts-ignore
            process.kill(-child.pid, "SIGTERM");
            // Force kill after short delay
            setTimeout(() => {
              try {
                if (!child.killed && child.pid) {
                  // @ts-ignore
                  process.kill(-child.pid, "SIGKILL");
                }
              } catch (error) {
                // Ignore errors
              }
            }, 1000);
          }
        } catch (error) {
          // Ignore errors
        }
        
        reject(new Error('Job cancelled'));
      }
    }, 2000); // Check every 2 seconds

    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      clearInterval(cancellationCheckInterval);
      
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
      clearInterval(cancellationCheckInterval);
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
  // Try oracle.txt first (for Oracle agent), then trajectory.json (for real LLM agents)
  const oraclePath = join(trialDir, "agent", "oracle.txt");
  const trajectoryPath = join(trialDir, "agent", "trajectory.json");
  
  try {
    // Check for Oracle agent output first
    const oracleContent = await readFile(oraclePath, "utf-8").catch(() => null);
    if (oracleContent) {
      console.log(`[Worker] Found oracle.txt, parsing Oracle agent output`);
      return {
        episodes: [{
          stateAnalysis: "Oracle agent execution",
          explanation: "Oracle agent knows the solution and executes it directly",
          commands: [{
            command: "oracle",
            output: oracleContent, // Full oracle.txt content
            exitCode: 0,
          }],
        }],
        totalDurationMs: 0,
      };
    }
    
    // Try trajectory.json for real LLM agents
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

// Helper function for immediate, visible logging
function logImmediate(emoji: string, message: string, ...args: any[]) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const output = `\n${emoji} [${timestamp}] [Worker] ${message}${args.length > 0 ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') : ''}\n`;
  process.stdout.write(output);
}

export async function processJob(job: QueuedJob) {
  logImmediate('🚀', `Starting job ${job.jobId.slice(0, 8)}... - Task: ${job.taskName}`);
  
  // Register job for cancellation tracking
  runningJobs.set(job.jobId, {
    jobId: job.jobId,
    taskName: job.taskName,
    processes: new Set<ChildProcess>(),
    attemptIds: new Set<string>(),
    cancelled: false,
  });
  
  const workDir = join(process.cwd(), "work", job.jobId);
  const taskDir = join(workDir, "task");
  const outputDir = join(workDir, "harbor-runs");
  
  try {
    await updateJobStatus(job.jobId, "running");
    logImmediate('▶️', `Job status updated to "running"`);
    
    // Check for cancellation before starting
    if (await isJobCancelled(job.jobId)) {
      throw new Error("Job cancelled before starting");
    }
    
    // Create working directories
    logImmediate('📁', `Creating working directories...`);
    await mkdir(workDir, { recursive: true });
    await mkdir(taskDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    
    // Download zip from S3 to temp location
    logImmediate('⬇️', `Downloading task zip from S3: ${job.zipPath}`);
    const s3Key = extractS3Key(job.zipPath);
    const zipBuffer = await downloadFile(s3Key);
    
    // Save to temp file for extraction
    const tempZipPath = join(workDir, "task.zip");
    await writeFile(tempZipPath, zipBuffer);
    logImmediate('✅', `Downloaded ${(zipBuffer.length / 1024).toFixed(2)} KB to ${tempZipPath}`);
    
    // Extract the zip file
    logImmediate('📦', `Extracting zip file...`);
    await extract(tempZipPath, { dir: taskDir });
    
    // Clean up temp zip file after extraction
    await unlink(tempZipPath);
    logImmediate('🗑️', `Cleaned up temp zip file`);
    
    // Find the actual task directory
    const actualTaskDir = await findTaskDirectory(taskDir);
    logImmediate('🔍', `Found task directory: ${actualTaskDir}`);
    
    // Create semaphore to limit concurrent attempts (max 10)
    const maxConcurrentAttempts = parseInt(process.env.MAX_CONCURRENT_ATTEMPTS_PER_JOB || "10", 10);
    const semaphore = new Semaphore(maxConcurrentAttempts);
    logImmediate('⚡', `Running ${job.runsRequested} attempts with max ${maxConcurrentAttempts} concurrent`);
    
    // Process a single attempt
    const processAttempt = async (attemptIndex: number) => {
      // Check for cancellation before starting attempt
      if (await isJobCancelled(job.jobId)) {
        logImmediate('⏸️', `Job ${job.jobId.slice(0, 8)}... cancelled, skipping attempt ${attemptIndex + 1}`);
        return;
      }
      
      // Acquire semaphore permit (waits if 10 attempts already running)
      await semaphore.acquire();
      
      try {
        const waiters = semaphore.getWaitersCount();
        logImmediate('🎯', `Attempt ${attemptIndex + 1}/${job.runsRequested} starting${waiters > 0 ? ` (${waiters} waiting)` : ''}`);
        
        const attempt = await createAttempt({
          jobId: job.jobId,
          index: attemptIndex,
          status: "running",
        });
        
        // Track this attempt for cancellation
        const runningJob = runningJobs.get(job.jobId);
        if (runningJob) {
          runningJob.attemptIds.add(attempt.id);
        }
        
          // Check for cancellation right after creating attempt (in case cancelled during semaphore wait)
          if (await isJobCancelled(job.jobId)) {
            logImmediate('⏸️', `Job ${job.jobId.slice(0, 8)}... cancelled before Harbor execution (Attempt ${attemptIndex + 1})`);
            await updateAttempt(attempt.id, {
              status: "failed",
              finishedAt: new Date(),
            });
            runningJob?.attemptIds.delete(attempt.id);
            // Don't increment progress when cancelled
            return;
          }
        
        const attemptStartTime = Date.now();
        
        try {
          const attemptOutputDir = join(outputDir, `attempt-${attemptIndex}`);
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
          
          const agentName = useTerminus2 ? 'Terminus 2 (GPT-5)' : 'Oracle agent';
          logImmediate('🤖', `Running Harbor with ${agentName} (Attempt ${attemptIndex + 1})`);
          
          const { stdout, stderr } = await runHarborCommand(
            'harbor',
            harborArgs,
            job.jobId,
            {
              cwd: process.cwd(),
              timeout: 15 * 60 * 1000, // 15 minutes
            }
          );
          
          if (stdout) logImmediate('📝', `Harbor stdout (first 200 chars): ${stdout.slice(0, 200)}...`);
          if (stderr) logImmediate('⚠️', `Harbor stderr (first 200 chars): ${stderr.slice(0, 200)}...`);
          
          // Parse Harbor output using helper functions
          const latestRunDir = await findLatestHarborOutput(attemptOutputDir);
          logImmediate('📂', `Found latest run directory: ${latestRunDir}`);
          
          const trialDir = await findTrialDirectory(latestRunDir);
          logImmediate('🔬', `Trial directory: ${trialDir}`);
          
          // Parse result.json
          const resultPath = join(trialDir, "result.json");
          const resultContent = await readFile(resultPath, "utf-8");
          const result: HarborTrialResult = JSON.parse(resultContent);
          
          // Parse rewards
          const rewards = result.verifier_result?.rewards || {};
          const testsPassed = Object.values(rewards).filter((r) => r === 1).length;
          const testsTotal = Object.keys(rewards).length;
          
          logImmediate('🧪', `Test results: ${testsPassed}/${testsTotal} passed`);
          
          // Parse trajectory for detailed episodes
          const { episodes } = await parseTrajectory(trialDir);
          logImmediate('📚', `Parsed ${episodes.length} episodes from trajectory`);
          
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
          
          // Check for cancellation AFTER Harbor completes but BEFORE updating status
          if (await isJobCancelled(job.jobId)) {
            logImmediate('🛑', `Job ${job.jobId.slice(0, 8)}... was cancelled after Harbor completed (Attempt ${attemptIndex + 1}), marking as failed`);
            await updateAttempt(attempt.id, {
              status: "failed",
              finishedAt: new Date(),
            });
            const runningJob = runningJobs.get(job.jobId);
            if (runningJob) {
              runningJob.attemptIds.delete(attempt.id);
            }
            // Don't increment progress when cancelled
            return;
          }
          
          const attemptStatus = testsPassed === testsTotal ? "success" : "failed";
          
          // Upload trial directory to S3
          logImmediate('☁️', `Uploading trial directory to S3 (Attempt ${attemptIndex + 1})...`);
          const s3Prefix = `results/${job.jobId}/attempt-${attemptIndex}/`;
          const uploadedUrls = await uploadDirectory(trialDir, s3Prefix);
          logImmediate('✅', `Uploaded ${uploadedUrls.length} files to S3`);
          
          // Store S3 URL in database (pointing to the trial directory root)
          const s3TrialUrl = `s3://${process.env.S3_BUCKET}/${s3Prefix}`;
          
          // Check for cancellation one more time before final update
          if (await isJobCancelled(job.jobId)) {
            logImmediate('🛑', `Job ${job.jobId.slice(0, 8)}... was cancelled before final update (Attempt ${attemptIndex + 1}), marking as failed`);
            await updateAttempt(attempt.id, {
              status: "failed",
              finishedAt: new Date(),
            });
            const runningJob = runningJobs.get(job.jobId);
            if (runningJob) {
              runningJob.attemptIds.delete(attempt.id);
            }
            // Don't increment progress when cancelled
            return;
          }
          
          // Update attempt with results and S3 log path
          await updateAttempt(attempt.id, {
            status: attemptStatus,
            testsPassed,
            testsTotal,
            rewardSummary: rewards,
            logPath: s3TrialUrl, // Store S3 URL instead of local path
            finishedAt: new Date(),
          });
          
          // Increment job progress
          await incrementJobProgress(job.jobId);
          
          // Remove from tracked attempts
          const runningJob = runningJobs.get(job.jobId);
          if (runningJob) {
            runningJob.attemptIds.delete(attempt.id);
          }
          
          const statusEmoji = attemptStatus === "success" ? "✅" : "❌";
          logImmediate(statusEmoji, `Attempt ${attemptIndex + 1} ${attemptStatus}: ${testsPassed}/${testsTotal} tests passed (${(attemptDuration / 1000).toFixed(1)}s)`);
        } catch (error) {
          const attemptDuration = Date.now() - attemptStartTime;
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          
          logImmediate('❌', `Attempt ${attemptIndex + 1} failed after ${(attemptDuration / 1000).toFixed(1)}s: ${errorMessage}`);
          
          // Check if this failure was due to cancellation
          const wasCancelled = errorMessage.includes("cancelled") || await isJobCancelled(job.jobId);
          
          // Update attempt with failure status
          await updateAttempt(attempt.id, {
            status: "failed",
            finishedAt: new Date(),
          });
          
          // Remove from tracked attempts
          const runningJob = runningJobs.get(job.jobId);
          if (runningJob) {
            runningJob.attemptIds.delete(attempt.id);
          }
          
          // Create a fallback episode explaining the error
          await createEpisode({
            attemptId: attempt.id,
            index: 0,
            stateAnalysis: "Attempt failed during execution",
            explanation: `Error: ${errorMessage}`,
            commands: [],
          });
          
          // Only increment progress if NOT cancelled (cancelled jobs should show 0% completion)
          if (!wasCancelled) {
            await incrementJobProgress(job.jobId);
          }
        }
      } finally {
        // Always release semaphore permit
        semaphore.release();
      }
    };
    
    // Run all attempts in parallel (limited by semaphore)
    const attemptPromises = Array.from({ length: job.runsRequested }, (_, i) =>
      processAttempt(i)
    );
    
    // Wait for all attempts to complete (or fail)
    const results = await Promise.allSettled(attemptPromises);
    
    // Log summary
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    logImmediate('📊', `Job ${job.jobId.slice(0, 8)}... attempts completed: ${succeeded} succeeded, ${failed} failed`);
    
    // Check if job was cancelled during execution
    if (await isJobCancelled(job.jobId)) {
      logImmediate('🛑', `Job ${job.jobId.slice(0, 8)}... was cancelled, skipping completion update`);
      
      // Update any remaining running attempts to failed
      const runningJob = runningJobs.get(job.jobId);
      if (runningJob && runningJob.attemptIds.size > 0) {
        logImmediate('🔄', `Updating ${runningJob.attemptIds.size} remaining attempt(s) to failed status...`);
        for (const attemptId of runningJob.attemptIds) {
          try {
            await updateAttempt(attemptId, {
              status: "failed",
              finishedAt: new Date(),
            });
          } catch (error) {
            // Ignore errors
          }
        }
      }
      
      // Also check database for any attempts that might have been marked as "success" 
      // after cancellation (race condition fix)
      try {
        const { db } = await import("../db/client.js");
        const { attempts } = await import("../db/schema.js");
        const { eq } = await import("drizzle-orm");
        
        if (db) {
          const allAttempts = await db
            .select()
            .from(attempts)
            .where(eq(attempts.jobId, job.jobId));
          
          // Find any attempts marked as "success" that should be "failed" due to cancellation
          const successAttempts = allAttempts.filter(a => a.status === "success");
          if (successAttempts.length > 0) {
            logImmediate('🔄', `Found ${successAttempts.length} attempt(s) marked as success after cancellation, updating to failed...`);
            for (const attempt of successAttempts) {
              try {
                await updateAttempt(attempt.id, {
                  status: "failed",
                  finishedAt: attempt.finishedAt || new Date(),
                });
              } catch (error) {
                // Ignore errors
              }
            }
          }
        }
      } catch (error) {
        // Ignore errors in cleanup
      }
      
      // Don't update to "completed", leave as "failed"
      return;
    }
    
    // Job completed - update status
    await updateJobStatus(job.jobId, "completed");
    logImmediate('🎉', `Job ${job.jobId.slice(0, 8)}... completed successfully!`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Check if job was cancelled
    if ((await isJobCancelled(job.jobId)) || errorMessage.includes("cancelled")) {
      logImmediate('🛑', `Job ${job.jobId.slice(0, 8)}... cancelled`);
      
      // Update all running attempts to failed status
      const runningJob = runningJobs.get(job.jobId);
      if (runningJob && runningJob.attemptIds.size > 0) {
        logImmediate('🔄', `Updating ${runningJob.attemptIds.size} running attempt(s) to failed status...`);
        let updatedCount = 0;
        for (const attemptId of runningJob.attemptIds) {
          try {
            await updateAttempt(attemptId, {
              status: "failed",
              finishedAt: new Date(),
            });
            updatedCount++;
          } catch (updateError) {
            const errMsg = updateError instanceof Error ? updateError.message : String(updateError);
            logImmediate('⚠️', `Failed to update attempt ${attemptId}: ${errMsg}`);
          }
        }
        logImmediate('✅', `Updated ${updatedCount}/${runningJob.attemptIds.size} attempt(s)`);
      }
      
      await updateJobStatus(job.jobId, "failed", "Job cancelled by user");
    } else {
      logImmediate('💥', `Job ${job.jobId.slice(0, 8)}... failed: ${errorMessage}`);
      await updateJobStatus(job.jobId, "failed", errorMessage);
    }
    
    // Don't re-throw - let the queue continue processing other jobs
  } finally {
    // Unregister job from running jobs
    runningJobs.delete(job.jobId);
    console.log(`[Worker] Unregistered job ${job.jobId}`);
    
    // Cleanup local work directory (artifacts are already in S3)
    try {
      await rm(workDir, { recursive: true, force: true });
      console.log(`[Worker] Cleaned up local work directory: ${workDir}`);
    } catch (cleanupError) {
      console.error(`[Worker] Failed to cleanup work directory:`, cleanupError);
      // Don't fail the job because of cleanup errors
    }
  }
}

