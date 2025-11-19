import { readdir, readFile, stat, access } from "fs/promises";
import { join, resolve } from "path";

/**
 * Extract S3 key from S3 URL
 * @param s3Url - S3 URL in format "s3://bucket/key/path.zip"
 * @returns The key portion (e.g., "key/path.zip")
 */
export function extractS3Key(s3Url: string): string {
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
 * Find the task directory within an extracted archive
 * Searches for task.toml at the base level or one level deep
 */
export async function findTaskDirectory(baseDir: string): Promise<string> {
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
 * Find the latest Harbor output directory
 * Harbor creates timestamped directories, we want the most recent one
 */
export async function findLatestHarborOutput(outputDir: string): Promise<string> {
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

/**
 * Find the trial directory within a Harbor run directory
 * Harbor typically creates one trial directory per run
 * @deprecated Use findAllTrialDirectories instead for --n-concurrent support
 */
export async function findTrialDirectory(runDir: string): Promise<string> {
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

/**
 * Find all trial directories within a Harbor run directory
 * When using --n-concurrent, Harbor creates multiple trial directories
 * Each trial directory contains a result.json file
 * @param runDir - Path to the Harbor run directory (timestamped directory)
 * @returns Array of trial directory paths, sorted by name for consistent ordering
 */
export async function findAllTrialDirectories(runDir: string): Promise<string[]> {
  const trialDirs: string[] = [];
  const entries = await readdir(runDir);
  
  for (const name of entries) {
    const entryPath = join(runDir, name);
    const stats = await stat(entryPath).catch(() => null);
    
    if (stats?.isDirectory()) {
      // Check if it's a trial directory (contains result.json)
      const resultPath = join(entryPath, "result.json");
      try {
        await stat(resultPath);
        trialDirs.push(entryPath);
      } catch {
        // Not a trial directory, skip (could be agent/, verifier/, or other files)
      }
    }
  }
  
  // Sort by name to ensure consistent ordering
  return trialDirs.sort();
}

/**
 * Find the Harbor executable path
 * Checks multiple locations:
 * 1. System PATH (if installed via uv tool install harbor or pip install harbor)
 * 2. Harbor venv in project root (for local installations)
 * 3. Harbor venv in current working directory
 * @returns Path to Harbor executable
 */
export async function findHarborExecutable(): Promise<string> {
  // First, try to find it in PATH (if installed via uv or pip)
  // This is the recommended installation method
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  
  try {
    const { stdout } = await execAsync("which harbor");
    const path = stdout.trim();
    if (path) {
      return path;
    }
  } catch {
    // 'which' failed, harbor not in PATH, try other locations
  }
  
  // Fallback: Check possible Harbor venv locations (for local installs)
  const possiblePaths = [
    // Production: Harbor venv in project root (relative to worker/)
    resolve(process.cwd(), "..", "harbor", "venv", "bin", "harbor"),
    // Alternative: Harbor venv in project root (absolute from worker/)
    resolve(process.cwd(), "..", "..", "harbor", "venv", "bin", "harbor"),
    // If worker is in project root
    resolve(process.cwd(), "harbor", "venv", "bin", "harbor"),
  ];
  
  // Check each path
  for (const harborPath of possiblePaths) {
    try {
      await access(harborPath);
      return harborPath;
    } catch {
      continue;
    }
  }
  
  // If not found anywhere
  throw new Error(
    `Harbor executable not found. Tried PATH and: ${possiblePaths.join(", ")}. ` +
    `Install Harbor with: uv tool install harbor (or pip install harbor)`
  );
}

