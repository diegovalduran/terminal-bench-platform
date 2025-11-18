/**
 * Environment variable validation
 * Validates all required environment variables on startup
 */

interface EnvConfig {
  DATABASE_URL: string;
  S3_BUCKET: string;
  S3_REGION: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  OPENAI_API_KEY?: string; // Optional, only needed for Terminus 2
}

interface ValidationResult {
  valid: boolean;
  missing: string[];
  errors: Array<{ key: string; message: string }>;
}

/**
 * Validate required environment variables
 */
export function validateEnvironment(): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    missing: [],
    errors: [],
  };

  const required: (keyof EnvConfig)[] = [
    "DATABASE_URL",
    "S3_BUCKET",
    "S3_REGION",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ];

  // Check for missing required variables
  for (const key of required) {
    const value = process.env[key];
    if (!value || value.trim() === "") {
      result.missing.push(key);
      result.valid = false;
    }
  }

  // Validate DATABASE_URL format
  if (process.env.DATABASE_URL) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
      result.errors.push({
        key: "DATABASE_URL",
        message: "Must start with 'postgresql://' or 'postgres://'",
      });
      result.valid = false;
    }
  }

  // Validate S3_REGION format (basic check)
  if (process.env.S3_REGION) {
    const region = process.env.S3_REGION;
    if (region.length < 3 || region.length > 20) {
      result.errors.push({
        key: "S3_REGION",
        message: "Must be a valid AWS region (3-20 characters)",
      });
      result.valid = false;
    }
  }

  // Validate S3_ACCESS_KEY_ID format (AWS access keys start with specific prefixes)
  if (process.env.S3_ACCESS_KEY_ID) {
    const accessKey = process.env.S3_ACCESS_KEY_ID;
    if (!accessKey.startsWith("AKIA") && accessKey.length !== 20) {
      result.errors.push({
        key: "S3_ACCESS_KEY_ID",
        message: "Should be a valid AWS access key ID (typically starts with 'AKIA' and is 20 characters)",
      });
      // Don't fail validation for this, just warn
    }
  }

  return result;
}

/**
 * Get environment configuration with type safety
 */
export function getEnvConfig(): EnvConfig {
  return {
    DATABASE_URL: process.env.DATABASE_URL!,
    S3_BUCKET: process.env.S3_BUCKET!,
    S3_REGION: process.env.S3_REGION!,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID!,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY!,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
}

/**
 * Validate and throw if invalid (for startup)
 */
export function validateEnvironmentOrThrow(): void {
  const validation = validateEnvironment();

  if (!validation.valid) {
    const messages: string[] = [];

    if (validation.missing.length > 0) {
      messages.push(
        `Missing required environment variables: ${validation.missing.join(", ")}`
      );
    }

    if (validation.errors.length > 0) {
      const errorMessages = validation.errors
        .map((e) => `${e.key}: ${e.message}`)
        .join("; ");
      messages.push(`Invalid environment variables: ${errorMessages}`);
    }

    throw new Error(`Environment validation failed:\n${messages.join("\n")}`);
  }
}

