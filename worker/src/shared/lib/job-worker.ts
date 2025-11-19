import { mkdir, readFile, rm, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import extract from "extract-zip";
import { QueuedJob } from "../types/runs.js";
import { updateJobStatus, incrementJobProgress } from "./job-service.js";
import { createAttempt, updateAttempt, createEpisode } from "./attempt-service.js";
import { downloadFile, uploadDirectory } from "./s3-service.js";
import { Semaphore } from "./semaphore.js";
import { registerJob, unregisterJob, addAttemptToJob, isJobCancelled, getRunningJob } from "./utils/process-management.js";
import { extractS3Key, findTaskDirectory, findLatestHarborOutput, findTrialDirectory } from "./utils/file-utils.js";
import { runHarborCommand } from "./utils/harbor-execution.js";
import { parseTrajectory, HarborTrialResult } from "./utils/trajectory-parser.js";
import { recoverPartialData } from "./utils/data-recovery.js";
import { logImmediate } from "./utils/logger.js";
import { buildDockerImage, updateTaskTomlWithDockerImage, generateDockerImageName } from "./utils/docker-utils.js";

// Re-export cancelJob for use by other modules (e.g., API routes)
export { cancelJob } from "./utils/process-management.js";

/**
 * Main job processing function
 * Orchestrates the entire job execution: download, extract, run Harbor, parse results, upload to S3
 */
export async function processJob(job: QueuedJob) {
  logImmediate('🚀', `Starting job ${job.jobId.slice(0, 8)}... - Task: ${job.taskName}`);
  
  // Register job for cancellation tracking
  registerJob(job.jobId, job.taskName);
  
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
    
    // Build Docker image once before starting attempts
    // This allows all attempts to reuse the same prebuilt image
    const dockerImageName = generateDockerImageName(job.taskName);
    try {
      await buildDockerImage(actualTaskDir, dockerImageName);
      // Update task.toml to use the prebuilt image
      await updateTaskTomlWithDockerImage(actualTaskDir, dockerImageName);
      logImmediate('✅', `Docker image built and configured for reuse: ${dockerImageName}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logImmediate('⚠️', `Failed to build Docker image, Harbor will build on-demand: ${errorMessage}`);
      // Continue anyway - Harbor will build the image on each attempt if needed
      // This is a graceful degradation
    }
    
    // Determine model for concurrency adjustment
    const hasApiKey = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 0;
    const model = process.env.HARBOR_MODEL || 'gpt-5';
    
    // Adjust concurrency based on model (cheaper models have stricter rate limits)
    const isCheapModel = model.includes('gpt-4o-mini') || model.includes('gpt-3.5');
    const defaultConcurrency = isCheapModel ? 5 : 10; // Lower concurrency for cheaper models
    const maxConcurrentAttempts = parseInt(process.env.MAX_CONCURRENT_ATTEMPTS_PER_JOB || String(defaultConcurrency), 10);
    const semaphore = new Semaphore(maxConcurrentAttempts);
    
    logImmediate('⚡', `Running ${job.runsRequested} attempts with max ${maxConcurrentAttempts} concurrent`);
    if (hasApiKey && isCheapModel) {
      logImmediate('⏱️', `Using reduced concurrency (${maxConcurrentAttempts}) for ${model} to avoid rate limits`);
    }
    
    // Process a single attempt
    const processAttempt = async (attemptIndex: number) => {
      // Check for cancellation before starting attempt
      if (await isJobCancelled(job.jobId)) {
        logImmediate('⏸️', `Job ${job.jobId.slice(0, 8)}... cancelled, skipping attempt ${attemptIndex + 1}`);
        return;
      }
      
      // Stagger attempt starts to avoid rate limits and resource contention
      // Delay increases with attempt index to spread out API calls over time
      // Default: 500ms between each attempt start (10 attempts spread over 4.5 seconds)
      const staggerDelayMs = 500;
      if (attemptIndex > 0) {
        const delay = attemptIndex * staggerDelayMs;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      // Acquire semaphore permit (waits if max attempts already running)
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
        addAttemptToJob(job.jobId, attempt.id);
        
        // Check for cancellation right after creating attempt (in case cancelled during semaphore wait)
        if (await isJobCancelled(job.jobId)) {
          logImmediate('⏸️', `Job ${job.jobId.slice(0, 8)}... cancelled before Harbor execution (Attempt ${attemptIndex + 1})`);
          await updateAttempt(attempt.id, {
            status: "failed",
            finishedAt: new Date(),
          });
          const runningJob = getRunningJob(job.jobId);
          if (runningJob) {
            runningJob.attemptIds.delete(attempt.id);
          }
          // Don't increment progress when cancelled
          return;
        }
        
        const attemptStartTime = Date.now();
        const attemptOutputDir = join(outputDir, `attempt-${attemptIndex}`);
        
        // Declare stdout/stderr outside try block so they're accessible in catch block
        let stdout = '';
        let stderr = '';
        
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
          
          const harborOutput = await runHarborCommand(
            'harbor',
            harborArgs,
            job.jobId,
            {
              cwd: process.cwd(),
              timeout: parseInt(process.env.HARBOR_TIMEOUT_MS || "1800000", 10), // Default 30 minutes
              logDir: attemptOutputDir, // Enable log streaming
              attemptIndex: attemptIndex, // For S3 path
            }
          );
          
          // Extract stdout and stderr from Harbor output
          stdout = harborOutput.stdout;
          stderr = harborOutput.stderr;
          
          if (stdout) logImmediate('📝', `Harbor stdout (first 200 chars): ${stdout.slice(0, 200)}...`);
          if (stderr) {
            // Log full stderr if it's short, otherwise first 500 chars
            const stderrPreview = stderr.length > 500 ? `${stderr.slice(0, 500)}...` : stderr;
            logImmediate('⚠️', `Harbor stderr: ${stderrPreview}`);
          }
          
          // Check for rate limit errors in stdout/stderr
          const isRateLimitError = (stdout && (
            stdout.includes('RateLimitError') ||
            stdout.includes('Rate limit reached') ||
            stdout.includes('rate limit') ||
            stdout.includes('429')
          )) || (stderr && (
            stderr.includes('RateLimitError') ||
            stderr.includes('Rate limit reached') ||
            stderr.includes('rate limit') ||
            stderr.includes('429') // HTTP 429 status code
          ));
          
          if (isRateLimitError) {
            logImmediate('🚫', `Rate limit error detected for Attempt ${attemptIndex + 1} - marking as failed`);
            const attemptDuration = Date.now() - attemptStartTime;
            
            // Mark attempt as failed with rate limit error
            await updateAttempt(attempt.id, {
              status: "failed",
              finishedAt: new Date(),
              testsPassed: 0,
              testsTotal: 1, // Show "0/1" instead of "0/0"
              metadata: {
                error: "Rate limit exceeded - too many concurrent API calls to OpenAI",
                errorType: "RateLimitError",
                errorDetails: stderr.slice(0, 500), // Store first 500 chars of error
                testCases: [
                  {
                    name: "API Rate Limit Exceeded",
                    status: "failed",
                    message: "OpenAI API rate limit was exceeded - the agent could not execute due to too many concurrent requests",
                    trace: `The Harbor agent failed to execute because the OpenAI API rate limit was reached. This can happen when:\n- Too many concurrent attempts are running\n- The API key has reached its request quota\n- Using a model with higher token usage (like gpt-5) increases the likelihood of hitting rate limits\n\nTo resolve:\n- Reduce MAX_CONCURRENT_ATTEMPTS_PER_JOB\n- Wait before starting new jobs\n- Consider upgrading your OpenAI account tier\n\nError details: ${stderr ? stderr.slice(0, 500) : stdout.slice(0, 500)}`,
                  },
                ],
              },
            });
            
            const runningJob = getRunningJob(job.jobId);
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
            
            // Log full Harbor stderr if available (might contain the actual error)
            if (stderr && stderr.length > 200) {
              logImmediate('🔍', `Full Harbor stderr (for debugging): ${stderr.slice(0, 1000)}${stderr.length > 1000 ? '...' : ''}`);
            }
            
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
            const runningJob = getRunningJob(job.jobId);
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
            const runningJob = getRunningJob(job.jobId);
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
          } else if (testsTotal === 0) {
            // Check for rate limit errors in stdout/stderr when we have 0/0 tests
            const isRateLimitError = (stdout && (
              stdout.includes('RateLimitError') ||
              stdout.includes('Rate limit reached') ||
              stdout.includes('rate limit') ||
              stdout.includes('429')
            )) || (stderr && (
              stderr.includes('RateLimitError') ||
              stderr.includes('Rate limit reached') ||
              stderr.includes('rate limit') ||
              stderr.includes('429')
            ));

            if (isRateLimitError) {
              // Add rate limit error as a test case entry
              attemptUpdates.metadata = {
                testCases: [
                  {
                    name: "API Rate Limit Exceeded",
                    status: "failed",
                    message: "OpenAI API rate limit was exceeded - the agent could not execute due to too many concurrent requests",
                    trace: `The Harbor agent failed to execute because the OpenAI API rate limit was reached. This can happen when:\n- Too many concurrent attempts are running\n- The API key has reached its request quota\n- Using a model with higher token usage (like gpt-5) increases the likelihood of hitting rate limits\n\nTo resolve:\n- Reduce MAX_CONCURRENT_ATTEMPTS_PER_JOB\n- Wait before starting new jobs\n- Consider upgrading your OpenAI account tier\n\nError details: ${stderr ? stderr.slice(0, 500) : stdout.slice(0, 500)}`,
                  },
                ],
              };
              attemptUpdates.testsTotal = 1; // Show "0/1" instead of "0/0"
            }
          }
          
          await updateAttempt(attempt.id, attemptUpdates);
          
          // Increment job progress
          await incrementJobProgress(job.jobId);
          
          // Remove from tracked attempts
          const runningJob = getRunningJob(job.jobId);
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

          // Check if this is a timeout error
          const isTimeout = errorMessage.includes("timed out");
          
          // Check for rate limit errors in stdout/stderr (captured before the error)
          const isRateLimitError = (stdout && (
            stdout.includes('RateLimitError') ||
            stdout.includes('Rate limit reached') ||
            stdout.includes('rate limit') ||
            stdout.includes('429')
          )) || (stderr && (
            stderr.includes('RateLimitError') ||
            stderr.includes('Rate limit reached') ||
            stderr.includes('rate limit') ||
            stderr.includes('429')
          ));
          
          // Add test cases to metadata if available
          if (partialData.testCases.length > 0) {
            attemptUpdates.metadata = { testCases: partialData.testCases };
          } else if (isRateLimitError && partialData.testsTotal === 0) {
            // For rate limit errors with no test cases recovered, add the rate limit as a test case entry
            attemptUpdates.metadata = {
              testCases: [
                {
                  name: "API Rate Limit Exceeded",
                  status: "failed",
                  message: "OpenAI API rate limit was exceeded - the agent could not execute due to too many concurrent requests",
                  trace: `The Harbor agent failed to execute because the OpenAI API rate limit was reached. This can happen when:\n- Too many concurrent attempts are running\n- The API key has reached its request quota\n- Using a model with higher token usage (like gpt-5) increases the likelihood of hitting rate limits\n\nTo resolve:\n- Reduce MAX_CONCURRENT_ATTEMPTS_PER_JOB\n- Wait before starting new jobs\n- Consider upgrading your OpenAI account tier\n\nError details: ${errorMessage}`,
                },
              ],
            };
            attemptUpdates.testsTotal = 1; // Show "0/1" instead of "0/0"
          } else if (isTimeout && partialData.testsTotal === 0) {
            // For timeout errors with no test cases recovered, add the timeout as a test case entry
            // This allows the UI to display the timeout reason where test cases would normally appear
            attemptUpdates.metadata = {
              testCases: [
                {
                  name: "Execution Timeout",
                  status: "failed",
                  message: errorMessage,
                  trace: `The Harbor agent execution exceeded the timeout limit (${parseInt(process.env.HARBOR_TIMEOUT_MS || "1800000", 10) / 1000 / 60} minutes). The agent may not have completed all test cases before timing out.`,
                },
              ],
            };
            // Update testsTotal to 1 so UI shows "0/1" instead of "0/0"
            attemptUpdates.testsTotal = 1;
          }

          // Add error information to metadata
          if (!attemptUpdates.metadata) {
            attemptUpdates.metadata = {};
          }
          attemptUpdates.metadata.error = errorMessage;
          attemptUpdates.metadata.errorType = isRateLimitError ? "RateLimitError" :
                                             isTimeout ? "TimeoutError" : 
                                             errorMessage.includes("cancelled") ? "CancellationError" : 
                                             "ExecutionError";

          // Update attempt with failure status and partial data
          await updateAttempt(attempt.id, attemptUpdates);
          
          // Remove from tracked attempts
          const runningJob = getRunningJob(job.jobId);
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
    
    // Run all attempts in parallel (concurrency controlled by semaphore)
    const attemptPromises = Array.from({ length: job.runsRequested }, (_, i) => {
      return processAttempt(i);
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
      const runningJob = getRunningJob(job.jobId);
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
      const runningJob = getRunningJob(job.jobId);
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
    unregisterJob(job.jobId);
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
