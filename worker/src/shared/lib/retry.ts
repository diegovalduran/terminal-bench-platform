/**
 * Retry utility for handling transient failures
 */

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
  onRetry: () => {},
};

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on last attempt
      if (attempt === opts.maxAttempts) {
        break;
      }

      // Call retry callback
      opts.onRetry(attempt, lastError);

      // Calculate delay with exponential backoff
      const delay = opts.delayMs * Math.pow(opts.backoffMultiplier, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error("Retry failed");
}

/**
 * Check if an error is retryable (transient failure)
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const errorMessage = error.message.toLowerCase();
  const errorName = error.name.toLowerCase();

  // Network errors
  if (
    errorMessage.includes("network") ||
    errorMessage.includes("timeout") ||
    errorMessage.includes("econnreset") ||
    errorMessage.includes("enotfound")
  ) {
    return true;
  }

  // AWS SDK errors that are retryable
  if (
    errorName.includes("throttling") ||
    errorName.includes("serviceunavailable") ||
    errorName.includes("requesttimeout") ||
    errorName.includes("requesttimeoutskewed")
  ) {
    return true;
  }

  // 5xx server errors (if error has status code)
  if ("$metadata" in error) {
    const metadata = (error as any).$metadata;
    if (metadata?.httpStatusCode >= 500) {
      return true;
    }
  }

  return false;
}

