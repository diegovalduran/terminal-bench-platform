/**
 * Startup validation - runs on server startup
 * Validates environment variables and logs warnings/errors
 */

import { validateEnvironment } from "./env-validation.js";

let validated = false;

/**
 * Validate environment on startup
 * Should be called early in the application lifecycle
 */
export function validateStartup(): void {
  if (validated) {
    return; // Only validate once
  }

  const validation = validateEnvironment();

  if (!validation.valid) {
    console.error("[Startup] ❌ Environment validation failed:");

    if (validation.missing.length > 0) {
      console.error(
        `[Startup]   Missing required variables: ${validation.missing.join(", ")}`
      );
    }

    if (validation.errors.length > 0) {
      validation.errors.forEach((error) => {
        console.error(`[Startup]   ${error.key}: ${error.message}`);
      });
    }

    console.error(
      "[Startup] Please check your .env.local file and ensure all required variables are set."
    );
  } else {
    console.log("[Startup] ✅ Environment variables validated");
  }

  validated = true;
}

/**
 * Get validation status (for testing/debugging)
 */
export function isStartupValidated(): boolean {
  return validated;
}

