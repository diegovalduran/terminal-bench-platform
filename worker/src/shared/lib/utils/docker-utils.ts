import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import * as TOML from "@iarna/toml";
import { logImmediate } from "./logger.js";

const execAsync = promisify(exec);

/**
 * Build Docker image once for a task
 * Uses docker compose to build the image with the same approach Harbor uses
 * @param taskDir - Path to the task directory containing Dockerfile
 * @param imageName - Name to tag the built image (e.g., "hb__build-cython-ext:latest")
 * @returns Promise that resolves when image is built
 */
export async function buildDockerImage(
  taskDir: string,
  imageName: string
): Promise<void> {
  logImmediate('🐳', `Building Docker image: ${imageName}`);
  
  const dockerfilePath = join(taskDir, "Dockerfile");
  
  // Check if Dockerfile exists
  try {
    await readFile(dockerfilePath, "utf-8");
  } catch (error) {
    throw new Error(`Dockerfile not found at ${dockerfilePath}`);
  }
  
  // Build the image using docker build (simpler than docker compose for our use case)
  // We use the same image naming convention as Harbor: hb__{task_name}
  const buildCommand = [
    "docker",
    "build",
    "-t",
    imageName,
    taskDir,
  ].join(" ");
  
  try {
    const { stdout, stderr } = await execAsync(buildCommand, {
      cwd: taskDir,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for build output
    });
    
    if (stderr && !stderr.includes("WARNING")) {
      // Docker build often writes to stderr even on success
      // Only log if it's not just warnings
      logImmediate('⚠️', `Docker build stderr: ${stderr.slice(0, 200)}`);
    }
    
    logImmediate('✅', `Docker image built successfully: ${imageName}`);
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logImmediate('❌', `Failed to build Docker image: ${errorMessage}`);
    throw new Error(`Docker build failed: ${errorMessage}`);
  }
}

/**
 * Update task.toml to use a prebuilt Docker image
 * This allows Harbor to use prebuilt mode instead of building on each attempt
 * @param taskDir - Path to the task directory containing task.toml
 * @param imageName - Name of the prebuilt Docker image
 */
export async function updateTaskTomlWithDockerImage(
  taskDir: string,
  imageName: string
): Promise<void> {
  const taskTomlPath = join(taskDir, "task.toml");
  
  logImmediate('📝', `Updating task.toml with docker_image: ${imageName}`);
  
  try {
    // Read existing task.toml
    const tomlContent = await readFile(taskTomlPath, "utf-8");
    const config = TOML.parse(tomlContent) as any;
    
    // Ensure environment section exists
    if (!config.environment) {
      config.environment = {};
    }
    
    // Set docker_image to use prebuilt image
    config.environment.docker_image = imageName;
    
    // Write back to task.toml
    const updatedToml = TOML.stringify(config);
    await writeFile(taskTomlPath, updatedToml, "utf-8");
    
    logImmediate('✅', `Updated task.toml with docker_image: ${imageName}`);
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logImmediate('❌', `Failed to update task.toml: ${errorMessage}`);
    throw new Error(`Failed to update task.toml: ${errorMessage}`);
  }
}

/**
 * Generate Docker image name for a task
 * Uses Harbor's naming convention: hb__{task_name}:{tag}
 * @param taskName - Name of the task
 * @param tag - Optional tag (defaults to "latest")
 * @returns Docker image name
 */
export function generateDockerImageName(taskName: string, tag: string = "latest"): string {
  // Harbor uses hb__ prefix and sanitizes task names
  const sanitized = taskName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  return `hb__${sanitized}:${tag}`;
}

/**
 * Remove Docker image after job completion (optional cleanup)
 * @param imageName - Name of the Docker image to remove
 */
export async function removeDockerImage(imageName: string): Promise<void> {
  logImmediate('🧹', `Removing Docker image: ${imageName}`);
  
  try {
    const { stdout, stderr } = await execAsync(`docker rmi ${imageName}`, {
      maxBuffer: 1024 * 1024, // 1MB buffer
    });
    
    if (stderr && !stderr.includes("No such image")) {
      logImmediate('⚠️', `Docker rmi stderr: ${stderr.slice(0, 200)}`);
    }
    
    logImmediate('✅', `Docker image removed: ${imageName}`);
  } catch (error: any) {
    // Ignore errors - image might not exist or might be in use
    // This is best-effort cleanup
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!errorMessage.includes("No such image") && !errorMessage.includes("image is being used")) {
      logImmediate('⚠️', `Failed to remove Docker image (non-critical): ${errorMessage}`);
    }
  }
}

