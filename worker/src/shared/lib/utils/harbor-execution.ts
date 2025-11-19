import { spawn, ChildProcess } from "child_process";
import { readFile, writeFile, appendFile } from "fs/promises";
import { join } from "path";
import { uploadFile } from "../s3-service.js";
import { addProcessToJob, isJobCancelled } from "./process-management.js";
import { findHarborExecutable } from "./file-utils.js";
import { logImmediate } from "./logger.js";

// Cache Harbor executable path to avoid repeated lookups
let cachedHarborPath: string | null = null;

/**
 * Get the Harbor executable path (cached)
 */
async function getHarborPath(): Promise<string> {
  if (cachedHarborPath) {
    return cachedHarborPath;
  }
  cachedHarborPath = await findHarborExecutable();
  return cachedHarborPath;
}

/**
 * Run a Harbor command and capture stdout/stderr
 * Supports log streaming to S3 for real-time visibility
 */
export async function runHarborCommand(
  command: string,
  args: string[],
  jobId: string,
  options: { cwd: string; timeout: number; logDir?: string; attemptIndex?: number }
): Promise<{ stdout: string; stderr: string }> {
  // Resolve Harbor executable path if command is 'harbor'
  const actualCommand = command === 'harbor' ? await getHarborPath() : command;
  
  const commandStartTime = Date.now();
  
  if (options.attemptIndex !== undefined) {
    logImmediate('🚀', `[Attempt ${options.attemptIndex + 1}] Starting Harbor process`);
  }
  
  return new Promise((resolve, reject) => {
    // Prepare environment variables for Harbor process
    // Explicitly pass OPENAI_API_KEY so Harbor can use it for Terminus 2
    // If using OpenRouter models, also set OPENROUTER_API_KEY (LiteLLM requires it)
    const env = {
      ...process.env, // Inherit all environment variables
      // Explicitly ensure OPENAI_API_KEY is available if set
      ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}),
      // For OpenRouter models, LiteLLM looks for OPENROUTER_API_KEY
      // Set it from OPENAI_API_KEY if not already set (allows using OPENAI_API_KEY for OpenRouter)
      ...(process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY 
        ? { OPENROUTER_API_KEY: process.env.OPENAI_API_KEY } 
        : {}),
    };
    
    const child = spawn(actualCommand, args, {
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
      
      const commandDuration = Date.now() - commandStartTime;
      if (options.attemptIndex !== undefined) {
        logImmediate('🏁', `[Attempt ${options.attemptIndex + 1}] Harbor process exited with code ${code}${signal ? ` (signal: ${signal})` : ''} after ${(commandDuration / 1000).toFixed(1)}s`);
      }
      
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
        // Log detailed exit error
        const attemptLabel = options.attemptIndex !== undefined ? `Attempt ${options.attemptIndex + 1}` : 'unknown attempt';
        logImmediate('❌', `Harbor exited with non-zero code ${code} for ${attemptLabel}`);
        logImmediate('🔍', `Command: ${actualCommand} ${args.join(' ')}`);
        logImmediate('🔍', `Exit code: ${code}`);
        logImmediate('🔍', `Signal: ${signal || 'none'}`);
        logImmediate('🔍', `Stdout length: ${stdout.length} chars`);
        logImmediate('🔍', `Stderr length: ${stderr.length} chars`);
        if (stdout) {
          const stdoutPreview = stdout.length > 500 ? `${stdout.slice(0, 500)}...` : stdout;
          logImmediate('🔍', `Stdout preview: ${stdoutPreview}`);
        }
        if (stderr) {
          const stderrPreview = stderr.length > 500 ? `${stderr.slice(0, 500)}...` : stderr;
          logImmediate('🔍', `Stderr preview: ${stderrPreview}`);
        }
        reject(new Error(`Harbor exited with code ${code}\nStderr: ${stderr}`));
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      clearInterval(cancellationCheckInterval);
      
      // Log detailed spawn error
      const attemptLabel = options.attemptIndex !== undefined ? `Attempt ${options.attemptIndex + 1}` : 'unknown attempt';
      logImmediate('❌', `Harbor spawn error for ${attemptLabel}`);
      logImmediate('🔍', `Command attempted: ${actualCommand} ${args.join(' ')}`);
      logImmediate('🔍', `Working directory: ${options.cwd}`);
      logImmediate('🔍', `Error name: ${error.name}`);
      logImmediate('🔍', `Error message: ${error.message}`);
      logImmediate('🔍', `Error code: ${(error as any).code || 'N/A'}`);
      logImmediate('🔍', `Error syscall: ${(error as any).syscall || 'N/A'}`);
      logImmediate('🔍', `Error path: ${(error as any).path || 'N/A'}`);
      if (error.stack) {
        logImmediate('🔍', `Error stack: ${error.stack}`);
      }
      
      // Check if it's a "command not found" error
      if ((error as any).code === 'ENOENT') {
        logImmediate('🔍', `ENOENT error: The command '${actualCommand}' was not found. Check PATH or executable path.`);
        logImmediate('🔍', `Current PATH: ${process.env.PATH || 'not set'}`);
      }
      
      reject(error);
    });
  });
}

