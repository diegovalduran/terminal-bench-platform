import { spawn, ChildProcess } from "child_process";
import { readFile, writeFile, appendFile } from "fs/promises";
import { join } from "path";
import { uploadFile } from "../s3-service.js";
import { addProcessToJob, isJobCancelled } from "./process-management.js";

/**
 * Run a Harbor command and capture stdout/stderr
 * Supports log streaming to S3 for real-time visibility
 */
export function runHarborCommand(
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

    // Register process with job for cancellation tracking
    addProcessToJob(jobId, child);

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

