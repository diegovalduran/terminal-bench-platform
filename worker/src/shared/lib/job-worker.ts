import { spawn, ChildProcess, exec } from "child_process";
import { promisify } from "util";
import { mkdir, readFile, readdir, stat, writeFile, unlink, rm, appendFile } from "fs/promises";
import { join } from "path";
import extract from "extract-zip";

const execAsync = promisify(exec);
import { QueuedJob } from "../types/runs.js";
import { updateJobStatus, incrementJobProgress } from "./job-service.js";
import { createAttempt, updateAttempt, createEpisode } from "./attempt-service.js";
import { downloadFile, uploadDirectory, uploadFile } from "./s3-service.js";
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
  options: { cwd: string; timeout: number; logDir?: string; attemptIndex?: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Prepare environment variables for Harbor process
    // Explicitly pass OPENAI_API_KEY so Harbor can use it for Terminus 2
    const env = {
      ...process.env, // Inherit all environment variables
      // Explicitly ensure OPENAI_API_KEY is available if set
      ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}),
    };
    
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true, // Create new process group for easier killing
      stdio: ['ignore', 'pipe', 'pipe'],
      env, // Pass environment variables explicitly
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
    
    // Set up log streaming if logDir is provided
    let stdoutLogPath: string | null = null;
    let stderrLogPath: string | null = null;
    let lastUploadTime = Date.now();
    const UPLOAD_INTERVAL_MS = 30000; // Upload logs every 30 seconds
    
    if (options.logDir && options.attemptIndex !== undefined) {
      stdoutLogPath = join(options.logDir, `harbor-stdout.log`);
      stderrLogPath = join(options.logDir, `harbor-stderr.log`);
      
      // Initialize log files
      writeFile(stdoutLogPath, '').catch(() => {});
      writeFile(stderrLogPath, '').catch(() => {});
    }
    
    // Helper to upload logs periodically
    const maybeUploadLogs = async () => {
      if (!stdoutLogPath || !stderrLogPath || options.attemptIndex === undefined) return;
      
      const now = Date.now();
      if (now - lastUploadTime < UPLOAD_INTERVAL_MS) return;
      lastUploadTime = now;
      
      try {
        const s3Prefix = `results/${jobId}/attempt-${options.attemptIndex}/logs/`;
        
        // Upload stdout log
        try {
          const stdoutContent = await readFile(stdoutLogPath, "utf-8").catch(() => '');
          if (stdoutContent) {
            await uploadFile(`${s3Prefix}harbor-stdout.log`, Buffer.from(stdoutContent), "text/plain");
          }
        } catch (e) {
          // Ignore upload errors - logs will be uploaded at the end anyway
        }
        
        // Upload stderr log
        try {
          const stderrContent = await readFile(stderrLogPath, "utf-8").catch(() => '');
          if (stderrContent) {
            await uploadFile(`${s3Prefix}harbor-stderr.log`, Buffer.from(stderrContent), "text/plain");
          }
        } catch (e) {
          // Ignore upload errors
        }
      } catch (error) {
        // Ignore periodic upload errors - logs will be uploaded at the end
      }
    };

    child.stdout?.on('data', async (data) => {
      const text = data.toString();
      stdout += text;
      
      // Append to log file if streaming is enabled
      if (stdoutLogPath) {
        try {
          await appendFile(stdoutLogPath, text);
          // Periodically upload logs (non-blocking)
          maybeUploadLogs().catch(() => {});
        } catch (error) {
          // Ignore log file errors
        }
      }
    });

    child.stderr?.on('data', async (data) => {
      const text = data.toString();
      stderr += text;
      
      // Append to log file if streaming is enabled
      if (stderrLogPath) {
        try {
          await appendFile(stderrLogPath, text);
          // Periodically upload logs (non-blocking)
          maybeUploadLogs().catch(() => {});
        } catch (error) {
          // Ignore log file errors
        }
      }
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

    child.on('exit', async (code, signal) => {
      clearTimeout(timeout);
      clearInterval(cancellationCheckInterval);
      
      // Final upload of logs if streaming was enabled
      if (stdoutLogPath && stderrLogPath && options.attemptIndex !== undefined) {
        try {
          const s3Prefix = `results/${jobId}/attempt-${options.attemptIndex}/logs/`;
          
          // Upload final stdout log
          try {
            const stdoutContent = await readFile(stdoutLogPath, "utf-8").catch(() => '');
            if (stdoutContent) {
              await uploadFile(`${s3Prefix}harbor-stdout.log`, Buffer.from(stdoutContent), "text/plain");
            }
          } catch (e) {
            // Ignore upload errors
          }
          
          // Upload final stderr log
          try {
            const stderrContent = await readFile(stderrLogPath, "utf-8").catch(() => '');
            if (stderrContent) {
              await uploadFile(`${s3Prefix}harbor-stderr.log`, Buffer.from(stderrContent), "text/plain");
            }
          } catch (e) {
            // Ignore upload errors
          }
        } catch (error) {
          // Ignore final upload errors
        }
      }
      
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
  // Legacy format fields
  observation?: string | { results?: Array<{ content?: string }> }; // Can be string (legacy) or object (ATIF)
  thought?: string;
  action?: string;
  command?: string;
  output?: string;
  exit_code?: number;
  // ATIF format (Terminus 2)
  step_id?: number;
  timestamp?: string;
  source?: "system" | "agent";
  message?: string;
  tool_calls?: Array<{
    tool_call_id?: string;
    function_name?: string;
    arguments?: {
      keystrokes?: string;
      duration?: number;
    };
  }>;
  metrics?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost_usd?: number;
  };
}

interface Trajectory {
  schema_version?: string;
  session_id?: string;
  agent?: {
    name?: string;
    version?: string;
    model_name?: string;
  };
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
  // Check trajectory.json FIRST (Terminus 2 and other LLM agents)
  // This takes priority because it's more structured and accurate
  // Only fall back to oracle.txt if trajectory.json doesn't exist
  const oraclePath = join(trialDir, "agent", "oracle.txt");
  const trajectoryPath = join(trialDir, "agent", "trajectory.json");
  
  try {
    // Try trajectory.json FIRST for real LLM agents (Terminus 2, etc.)
    const trajectoryContent = await readFile(trajectoryPath, "utf-8").catch(() => null);
    
    if (trajectoryContent) {
      // We have trajectory.json, parse it (this is the primary format for Terminus 2)
      // Skip oracle.txt check since trajectory.json takes priority
      const trajectory: Trajectory = JSON.parse(trajectoryContent);
      
      const episodes: Array<{
        stateAnalysis: string;
        explanation: string;
        commands: Array<{ command: string; output: string; exitCode?: number }>;
      }> = [];
      
      // Check if this is ATIF format (Terminus 2) - has schema_version and steps with source/message
      const isATIF = trajectory.schema_version && trajectory.steps && Array.isArray(trajectory.steps);
      
      if (isATIF && trajectory.steps) {
        // Parse ATIF format (Terminus 2)
        // Group steps by agent episodes (each agent step with tool_calls is an episode)
        let currentEpisode: {
          stateAnalysis: string;
          explanation: string;
          commands: Array<{ command: string; output: string; exitCode?: number }>;
        } | null = null;
        
        for (const step of trajectory.steps) {
          // Agent steps contain the analysis/plan and commands
          if (step.source === "agent" && step.message) {
            // Extract analysis and plan from message
            // Message format: "Analysis: ...\nPlan: ..."
            const messageLines = step.message.split('\n');
            let analysis = "";
            let plan = "";
            let inAnalysis = false;
            let inPlan = false;
            
            for (const line of messageLines) {
              if (line.startsWith("Analysis:")) {
                inAnalysis = true;
                inPlan = false;
                analysis = line.replace(/^Analysis:\s*/, "");
              } else if (line.startsWith("Plan:")) {
                inPlan = true;
                inAnalysis = false;
                plan = line.replace(/^Plan:\s*/, "");
              } else if (inAnalysis) {
                analysis += "\n" + line;
              } else if (inPlan) {
                plan += "\n" + line;
              }
            }
            
            // If no explicit Analysis/Plan, use the whole message as explanation
            const explanation = plan || analysis || step.message;
            const stateAnalysis = analysis || "Agent analysis";
            
            // Extract commands from tool_calls
            const commands: Array<{ command: string; output: string; exitCode?: number }> = [];
            if (step.tool_calls && Array.isArray(step.tool_calls)) {
              for (const toolCall of step.tool_calls) {
                if (toolCall.function_name === "bash_command" && toolCall.arguments?.keystrokes) {
                  commands.push({
                    command: toolCall.arguments.keystrokes.trim(),
                    output: "", // Will be filled from next observation step
                    exitCode: undefined,
                  });
                }
              }
            }
            
            // Create new episode
            currentEpisode = {
              stateAnalysis: stateAnalysis.trim() || "Agent analysis",
              explanation: explanation.trim() || "Agent plan",
              commands,
            };
          }
          // Observation steps contain terminal output
          // Check for ATIF observation structure (nested object with results array)
          else if (step.source === "system" && step.observation && typeof step.observation === "object" && !Array.isArray(step.observation) && "results" in step.observation) {
            // Get terminal output from observation
            const obs = step.observation as { results?: Array<{ content?: string }> };
            const terminalOutput = obs.results
              ?.map(r => r.content || "")
              .join("\n")
              .trim() || "";
            
            // If we have a current episode, add output to the last command
            if (currentEpisode && currentEpisode.commands.length > 0) {
              const lastCommand = currentEpisode.commands[currentEpisode.commands.length - 1];
              if (!lastCommand.output) {
                lastCommand.output = terminalOutput;
              } else {
                // If output already exists, append (multiple observations per command)
                lastCommand.output += "\n" + terminalOutput;
              }
            } else if (terminalOutput) {
              // If no current episode but we have output, create a basic episode
              currentEpisode = {
                stateAnalysis: "Terminal output",
                explanation: "System observation",
                commands: [{
                  command: "",
                  output: terminalOutput,
                  exitCode: undefined,
                }],
              };
            }
          }
          
          // If we have a complete episode (with commands and output), add it
          if (currentEpisode && currentEpisode.commands.length > 0) {
            // Check if this episode is complete (has output for at least one command)
            const hasOutput = currentEpisode.commands.some(c => c.output);
            if (hasOutput || step.source === "agent") {
              // Only add episode if it has meaningful content
              if (currentEpisode.stateAnalysis || currentEpisode.explanation || currentEpisode.commands.length > 0) {
                episodes.push(currentEpisode);
                currentEpisode = null; // Reset for next episode
              }
            }
          }
        }
        
        // Add final episode if it exists
        if (currentEpisode && (currentEpisode.commands.length > 0 || currentEpisode.stateAnalysis || currentEpisode.explanation)) {
          episodes.push(currentEpisode);
        }
        
        // Return early since we successfully parsed trajectory.json
        return {
          episodes: episodes.length > 0 ? episodes : [{
            stateAnalysis: "No detailed trajectory available",
            explanation: "Agent completed execution",
            commands: [],
          }],
          totalDurationMs: 0,
        };
      }
      // Legacy format: steps-based trajectory (simple format)
      else if (trajectory.steps && Array.isArray(trajectory.steps)) {
        for (const step of trajectory.steps) {
          const commands: Array<{ command: string; output: string; exitCode?: number }> = [];
          
          if (step.command) {
            commands.push({
              command: step.command,
              output: step.output || "",
              exitCode: step.exit_code,
            });
          }
          
          // Handle observation (can be string or object)
          const observationText = typeof step.observation === "string" 
            ? step.observation 
            : "No observation recorded";
          
          episodes.push({
            stateAnalysis: observationText,
            explanation: step.thought || step.action || "Agent action",
            commands,
          });
        }
      }
      // Legacy format: action-based trajectory
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
    }
    
    // Only check oracle.txt if trajectory.json doesn't exist
    // This ensures Terminus 2 output takes priority over any leftover oracle.txt files
    const oracleContent = await readFile(oraclePath, "utf-8").catch(() => null);
    if (oracleContent && oracleContent.trim().length > 0) {
      // Only treat as Oracle if file has actual content (not empty)
      console.log(`[Worker] Found oracle.txt (no trajectory.json), parsing Oracle agent output`);
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
    
    // Neither trajectory.json nor oracle.txt exists (or oracle.txt is empty)
    // Add diagnostic logging to understand why
    const agentDir = join(trialDir, "agent");
    const agentDirExists = await stat(agentDir).then(() => true).catch(() => false);
    
    let diagnosticMessage = "Agent output files not found";
    
    if (!agentDirExists) {
      console.log(`[Worker] Agent directory missing - agent may not have run`);
      diagnosticMessage = "Agent directory not found - agent may have crashed before creating output files";
    } else {
      // Check if directory is empty
      try {
        const agentFiles = await readdir(agentDir);
        if (agentFiles.length === 0) {
          console.log(`[Worker] Agent directory is empty - agent may have crashed before writing files`);
          diagnosticMessage = "Agent directory exists but is empty - agent may have crashed before creating trajectory files";
        } else {
          console.log(`[Worker] Agent directory exists with ${agentFiles.length} file(s): ${agentFiles.join(', ')}`);
          diagnosticMessage = "Trajectory files not found - agent may have timed out or crashed before completing execution";
        }
      } catch (error) {
        console.log(`[Worker] Error reading agent directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
        diagnosticMessage = "Agent directory exists but could not be read";
      }
    }
    
    console.log(`[Worker] No trajectory file found (neither trajectory.json nor valid oracle.txt)`);
    return {
      episodes: [{
        stateAnalysis: "Agent execution incomplete",
        explanation: diagnosticMessage,
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

/**
 * Attempts to recover partial data from a failed attempt
 * This allows users to see what was done before the error occurred
 */
async function recoverPartialData(
  attemptId: string,
  attemptOutputDir: string,
  attemptIndex: number,
  jobId: string
): Promise<{
  episodesFound: number;
  testsPassed: number;
  testsTotal: number;
  testCases: Array<{ name: string; status: string; trace?: string; message?: string }>;
  s3Url: string | null;
}> {
  const result = {
    episodesFound: 0,
    testsPassed: 0,
    testsTotal: 0,
    testCases: [] as Array<{ name: string; status: string; trace?: string; message?: string }>,
    s3Url: null as string | null,
  };

  try {
    // Try to find the latest run directory (even if Harbor didn't complete)
    const latestRunDir = await findLatestHarborOutput(attemptOutputDir).catch(() => null);
    if (!latestRunDir) {
      logImmediate('⚠️', `No Harbor output directory found for partial data recovery`);
      return result;
    }

    const trialDir = await findTrialDirectory(latestRunDir).catch(() => null);
    if (!trialDir) {
      logImmediate('⚠️', `No trial directory found for partial data recovery`);
      return result;
    }

    logImmediate('🔍', `Attempting to recover partial data from ${trialDir}`);

    // Try to parse partial trajectory.json
    try {
      const { episodes } = await parseTrajectory(trialDir);
      if (episodes.length > 0) {
        logImmediate('📚', `Found ${episodes.length} partial episodes in trajectory`);
        
        // Create episodes from partial trajectory
        for (let i = 0; i < episodes.length; i++) {
          try {
            await createEpisode({
              attemptId,
              index: i,
              stateAnalysis: episodes[i].stateAnalysis,
              explanation: episodes[i].explanation,
              commands: episodes[i].commands,
              durationMs: undefined,
            });
            result.episodesFound++;
          } catch (episodeError) {
            // Ignore individual episode creation errors
            logImmediate('⚠️', `Failed to create episode ${i}: ${episodeError instanceof Error ? episodeError.message : 'Unknown error'}`);
          }
        }
      }
    } catch (trajectoryError) {
      logImmediate('⚠️', `Failed to parse trajectory: ${trajectoryError instanceof Error ? trajectoryError.message : 'Unknown error'}`);
    }

    // Try to parse partial test results
    try {
      // Try ctrf.json first (structured format)
      const ctrfPath = join(trialDir, "verifier", "ctrf.json");
      const ctrfContent = await readFile(ctrfPath, "utf-8").catch(() => null);

      if (ctrfContent) {
        try {
          const ctrf = JSON.parse(ctrfContent);
          if (ctrf.results?.summary) {
            result.testsPassed = ctrf.results.summary.passed || 0;
            result.testsTotal = ctrf.results.summary.tests || 0;
          }
          if (ctrf.results?.tests && Array.isArray(ctrf.results.tests)) {
            result.testCases = ctrf.results.tests.map((test: any) => ({
              name: test.name || "Unknown test",
              status: test.status || "unknown",
              trace: test.trace,
              message: test.message,
            }));
          }
          logImmediate('🧪', `Found partial test results: ${result.testsPassed}/${result.testsTotal} passed`);
        } catch (parseError) {
          // Ignore parse errors
        }
      }

      // Fallback to result.json if ctrf.json not available
      if (result.testsTotal === 0) {
        try {
          const resultPath = join(trialDir, "result.json");
          const resultContent = await readFile(resultPath, "utf-8");
          const harborResult: HarborTrialResult = JSON.parse(resultContent);
          const rewards = harborResult.verifier_result?.rewards || {};
          result.testsPassed = Object.values(rewards).filter((r) => r === 1).length;
          result.testsTotal = Object.keys(rewards).length || 0;
          if (result.testsTotal > 0) {
            logImmediate('🧪', `Found partial test results from result.json: ${result.testsPassed}/${result.testsTotal} passed`);
          }
        } catch (resultError) {
          // Ignore parse errors
        }
      }
    } catch (testError) {
      logImmediate('⚠️', `Failed to parse test results: ${testError instanceof Error ? testError.message : 'Unknown error'}`);
    }

    // Try to upload whatever files exist to S3
    try {
      const s3Prefix = `results/${jobId}/attempt-${attemptIndex}/`;
      await uploadDirectory(trialDir, s3Prefix);
      result.s3Url = `s3://${process.env.S3_BUCKET}/${s3Prefix}`;
      logImmediate('☁️', `Uploaded partial files to S3: ${result.s3Url}`);
    } catch (uploadError) {
      logImmediate('⚠️', `Failed to upload partial files: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`);
    }

    if (result.episodesFound > 0 || result.testsTotal > 0 || result.s3Url) {
      logImmediate('✅', `Partial data recovery successful: ${result.episodesFound} episodes, ${result.testsPassed}/${result.testsTotal} tests, S3: ${result.s3Url ? 'yes' : 'no'}`);
    } else {
      logImmediate('ℹ️', `No partial data found to recover`);
    }
  } catch (error) {
    // Don't throw - recovery is best effort
    logImmediate('⚠️', `Partial data recovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return result;
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
    
    // Clean up any previous run data for this job (fresh start)
    logImmediate('🧹', `Cleaning up previous run data for job ${job.jobId.slice(0, 8)}...`);
    try {
      await rm(workDir, { recursive: true, force: true });
      logImmediate('✅', `Cleaned up previous work directory`);
    } catch (error) {
      // Ignore errors if directory doesn't exist (first run)
      logImmediate('ℹ️', `No previous work directory to clean (first run)`);
    }
    
    // Create working directories (fresh)
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
    
    // Determine model for concurrency adjustment
    const hasApiKey = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 0;
    const model = process.env.HARBOR_MODEL || 'gpt-5-mini';
    
    // Adjust concurrency based on model (cheaper models have stricter rate limits)
    const isCheapModel = model.includes('gpt-4o-mini') || model.includes('gpt-3.5');
    const defaultConcurrency = isCheapModel ? 5 : 10; // Lower concurrency for cheaper models
    const maxConcurrentAttempts = parseInt(process.env.MAX_CONCURRENT_ATTEMPTS_PER_JOB || String(defaultConcurrency), 10);
    const semaphore = new Semaphore(maxConcurrentAttempts);
    
    // Stagger delay between attempts (in milliseconds) to spread out API calls
    const staggerDelayMs = parseInt(process.env.ATTEMPT_STAGGER_DELAY_MS || "2000", 10); // Default 2 seconds
    
    logImmediate('⚡', `Running ${job.runsRequested} attempts with max ${maxConcurrentAttempts} concurrent`);
    if (hasApiKey && isCheapModel) {
      logImmediate('⏱️', `Using reduced concurrency (${maxConcurrentAttempts}) and ${staggerDelayMs}ms stagger for ${model} to avoid rate limits`);
    }
    
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
        const attemptOutputDir = join(outputDir, `attempt-${attemptIndex}`);
        
        try {
          await mkdir(attemptOutputDir, { recursive: true });
          
          // Use model and hasApiKey from outer scope (already determined)
          const useTerminus2 = hasApiKey;
          const isGPT5 = model.includes('gpt-5');
          
          if (useTerminus2) {
            const apiKeyPreview = process.env.OPENAI_API_KEY?.substring(0, 10) || 'unknown';
            logImmediate('🔑', `API Key detected: ${apiKeyPreview}... (Terminus 2 enabled)`);
            logImmediate('🤖', `Using model: ${model}`);
          } else {
            logImmediate('⚠️', `No OPENAI_API_KEY found, using Oracle agent`);
          }
          
          const harborArgs = [
            'run',
            '--path', actualTaskDir,
            '--agent', useTerminus2 ? 'terminus-2' : 'oracle',
            ...(useTerminus2 ? ['--model', model] : []),
            // Add reasoning_effort for gpt-5 only (not supported by other models)
            ...(useTerminus2 && isGPT5 ? ['--ak', 'reasoning_effort=medium'] : []),
            '--env', 'docker',
            '--jobs-dir', attemptOutputDir,
            '--n-concurrent', '1',
          ];
          
          const agentName = useTerminus2 ? `Terminus 2 (${model})` : 'Oracle agent';
          logImmediate('🤖', `Running Harbor with ${agentName} (Attempt ${attemptIndex + 1})`);
          
          const { stdout, stderr } = await runHarborCommand(
            'harbor',
            harborArgs,
            job.jobId,
            {
              cwd: process.cwd(),
              timeout: 15 * 60 * 1000, // 15 minutes
              logDir: attemptOutputDir, // Enable log streaming
              attemptIndex: attemptIndex, // For S3 path
            }
          );
          
          if (stdout) logImmediate('📝', `Harbor stdout (first 200 chars): ${stdout.slice(0, 200)}...`);
          if (stderr) logImmediate('⚠️', `Harbor stderr (first 200 chars): ${stderr.slice(0, 200)}...`);
          
          // Check for rate limit errors in stderr
          const isRateLimitError = stderr && (
            stderr.includes('RateLimitError') ||
            stderr.includes('Rate limit reached') ||
            stderr.includes('rate limit') ||
            stderr.includes('429') // HTTP 429 status code
          );
          
          if (isRateLimitError) {
            logImmediate('🚫', `Rate limit error detected for Attempt ${attemptIndex + 1} - marking as failed`);
            const attemptDuration = Date.now() - attemptStartTime;
            
            // Mark attempt as failed with rate limit error
            await updateAttempt(attempt.id, {
              status: "failed",
              finishedAt: new Date(),
              metadata: {
                error: "Rate limit exceeded - too many concurrent API calls to OpenAI",
                errorType: "RateLimitError",
                errorDetails: stderr.slice(0, 500), // Store first 500 chars of error
              },
            });
            
            const runningJob = runningJobs.get(job.jobId);
            if (runningJob) {
              runningJob.attemptIds.delete(attempt.id);
            }
            
            logImmediate('❌', `Attempt ${attemptIndex + 1} failed due to rate limit after ${(attemptDuration / 1000).toFixed(1)}s`);
            // Don't increment progress for rate limit failures
            return;
          }
          
          // Parse Harbor output using helper functions
          const latestRunDir = await findLatestHarborOutput(attemptOutputDir);
          logImmediate('📂', `Found latest run directory: ${latestRunDir}`);
          
          const trialDir = await findTrialDirectory(latestRunDir);
          logImmediate('🔬', `Trial directory: ${trialDir}`);
          
          // Parse result.json
          const resultPath = join(trialDir, "result.json");
          const resultContent = await readFile(resultPath, "utf-8");
          const result: HarborTrialResult = JSON.parse(resultContent);
          
          // Parse test results from ctrf.json (structured format)
          let testsPassed = 0;
          let testsTotal = 0;
          let testCases: Array<{
            name: string;
            status: string;
            trace?: string;
            message?: string;
          }> = [];
          
          const ctrfPath = join(trialDir, "verifier", "ctrf.json");
          const ctrfContent = await readFile(ctrfPath, "utf-8").catch(() => null);
          
          if (ctrfContent) {
            try {
              const ctrf = JSON.parse(ctrfContent);
              if (ctrf.results?.summary) {
                testsPassed = ctrf.results.summary.passed || 0;
                testsTotal = ctrf.results.summary.tests || 0;
              }
              if (ctrf.results?.tests && Array.isArray(ctrf.results.tests)) {
                testCases = ctrf.results.tests.map((test: any) => ({
                  name: test.name || "Unknown test",
                  status: test.status || "unknown",
                  trace: test.trace,
                  message: test.message,
                }));
              }
            } catch (error) {
              console.error(`[Worker] Failed to parse ctrf.json:`, error);
            }
          }
          
          // Fallback to result.json rewards if ctrf.json not available
          if (testsTotal === 0) {
            const rewards = result.verifier_result?.rewards || {};
            testsPassed = Object.values(rewards).filter((r) => r === 1).length;
            testsTotal = Object.keys(rewards).length || 0;
          }
          
          // Diagnostic logging for 0/0 tests
          if (testsTotal === 0) {
            logImmediate('⚠️', `No test results found (0/0) - investigating cause...`);
            
            // Check verifier directory
            const verifierDir = join(trialDir, "verifier");
            const verifierExists = await stat(verifierDir).then(() => true).catch(() => false);
            
            // Check test output files
            const testStdoutPath = join(verifierDir, "test-stdout.txt");
            const testStdoutExists = await stat(testStdoutPath).then(() => true).catch(() => false);
            const testStderrPath = join(verifierDir, "test-stderr.txt");
            const testStderrExists = await stat(testStderrPath).then(() => true).catch(() => false);
            
            // Check result.json structure
            if (!result.verifier_result) {
              logImmediate('❌', `result.json has no verifier_result - verifier may not have run`);
            } else if (!result.verifier_result.rewards || Object.keys(result.verifier_result.rewards).length === 0) {
              logImmediate('❌', `verifier_result.rewards is empty - tests may not have executed`);
            }
            
            if (!verifierExists) {
              logImmediate('❌', `Verifier directory missing - verifier did not run`);
            } else if (!testStdoutExists && !testStderrExists) {
              logImmediate('❌', `Test output files missing - tests did not execute`);
            } else if (testStdoutExists) {
              // Try to read test stdout for clues
              try {
                const testStdout = await readFile(testStdoutPath, "utf-8");
                const stdoutPreview = testStdout.slice(0, 200);
                logImmediate('ℹ️', `Test stdout exists (${testStdout.length} chars): ${stdoutPreview}...`);
              } catch (e) {
                // Ignore read errors
              }
            }
          }
          
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
          
          // Treat 0/0 as failed (something went wrong, not success)
          // 0/0 means tests didn't run or verifier failed, which is a failure case
          const attemptStatus = (testsTotal === 0) 
            ? "failed"  // 0/0 means something went wrong
            : (testsPassed === testsTotal ? "success" : "failed");
          
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
          
          // Get rewards from result.json for rewardSummary
          const rewards = result.verifier_result?.rewards || {};
          
          // Update attempt with results and S3 log path
          const attemptUpdates: Parameters<typeof updateAttempt>[1] = {
            status: attemptStatus,
            testsPassed,
            testsTotal,
            rewardSummary: rewards,
            logPath: s3TrialUrl, // Store S3 URL instead of local path
            finishedAt: new Date(),
          };
          
          // Add test cases to metadata if available
          if (testCases.length > 0) {
            attemptUpdates.metadata = { testCases };
          }
          
          await updateAttempt(attempt.id, attemptUpdates);
          
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
          
          // Try to recover partial data before marking as failed
          // This allows users to see what was done before the error
          let partialData = {
            episodesFound: 0,
            testsPassed: 0,
            testsTotal: 0,
            testCases: [] as Array<{ name: string; status: string; trace?: string; message?: string }>,
            s3Url: null as string | null,
          };

          try {
            partialData = await recoverPartialData(attempt.id, attemptOutputDir, attemptIndex, job.jobId);
          } catch (recoveryError) {
            // Don't fail the attempt if recovery fails - it's best effort
            logImmediate('⚠️', `Partial data recovery encountered an error: ${recoveryError instanceof Error ? recoveryError.message : 'Unknown error'}`);
          }
          
          // Prepare attempt update with partial data
          const attemptUpdates: Parameters<typeof updateAttempt>[1] = {
            status: "failed",
            finishedAt: new Date(),
            testsPassed: partialData.testsPassed,
            testsTotal: partialData.testsTotal,
            logPath: partialData.s3Url || undefined,
          };

          // Add test cases to metadata if available
          if (partialData.testCases.length > 0) {
            attemptUpdates.metadata = { testCases: partialData.testCases };
          }

          // Add error information to metadata
          if (!attemptUpdates.metadata) {
            attemptUpdates.metadata = {};
          }
          attemptUpdates.metadata.error = errorMessage;
          attemptUpdates.metadata.errorType = errorMessage.includes("timed out") ? "TimeoutError" : 
                                             errorMessage.includes("cancelled") ? "CancellationError" : 
                                             "ExecutionError";

          // Update attempt with failure status and partial data
          await updateAttempt(attempt.id, attemptUpdates);
          
          // Remove from tracked attempts
          const runningJob = runningJobs.get(job.jobId);
          if (runningJob) {
            runningJob.attemptIds.delete(attempt.id);
          }
          
          // Only create fallback episode if we didn't recover any episodes
          if (partialData.episodesFound === 0) {
            await createEpisode({
              attemptId: attempt.id,
              index: 0,
              stateAnalysis: "Attempt failed during execution",
              explanation: `Error: ${errorMessage}${partialData.s3Url ? '\n\nPartial logs available for download.' : ''}`,
              commands: [],
            });
          }
          
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
    
    // Run all attempts with staggered starts to avoid rate limits
    // Each attempt starts with a delay to spread out API calls over time
    const attemptPromises = Array.from({ length: job.runsRequested }, (_, i) => {
      // Stagger start times: attempt 0 starts immediately, attempt 1 after staggerDelayMs, etc.
      const startDelay = i * staggerDelayMs;
      
      if (startDelay > 0) {
        logImmediate('⏳', `Attempt ${i + 1} will start in ${(startDelay / 1000).toFixed(1)}s (staggered)`);
      }
      
      return new Promise<void>((resolve, reject) => {
        setTimeout(async () => {
          try {
            await processAttempt(i);
            resolve();
          } catch (error) {
            reject(error);
          }
        }, startDelay);
      });
    });
    
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

