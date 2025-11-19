/**
 * Rate Limit Manager
 * Tracks rate limit errors and adaptively adjusts concurrency to prevent future rate limits
 */

interface RateLimitEvent {
  timestamp: number;
  jobId: string;
  attemptIndex: number;
}

class RateLimitManager {
  private events: RateLimitEvent[] = [];
  private readonly windowMs: number = 5 * 60 * 1000; // 5 minute window
  private readonly maxEventsBeforeReduction: number = 2; // Reduce concurrency after 2 rate limits
  private currentConcurrencyMultiplier: number = 1.0; // Start at 100% concurrency
  private readonly minConcurrencyMultiplier: number = 0.5; // Don't go below 50%
  private readonly recoveryWindowMs: number = 10 * 60 * 1000; // 10 minutes before recovery
  private lastRateLimitTime: number = 0;

  /**
   * Record a rate limit error
   */
  recordRateLimit(jobId: string, attemptIndex: number): void {
    const now = Date.now();
    this.events.push({ timestamp: now, jobId, attemptIndex });
    this.lastRateLimitTime = now;
    
    // Clean up old events outside the window
    this.events = this.events.filter(
      (event) => now - event.timestamp < this.windowMs
    );
    
    // If we have too many rate limits in the window, reduce concurrency
    if (this.events.length >= this.maxEventsBeforeReduction) {
      this.reduceConcurrency();
    }
  }

  /**
   * Reduce concurrency multiplier
   */
  private reduceConcurrency(): void {
    const newMultiplier = Math.max(
      this.minConcurrencyMultiplier,
      this.currentConcurrencyMultiplier * 0.75 // Reduce by 25%
    );
    
    if (newMultiplier < this.currentConcurrencyMultiplier) {
      this.currentConcurrencyMultiplier = newMultiplier;
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      process.stdout.write(
        `\n⚠️ [${timestamp}] [RateLimit] Reducing concurrency to ${(this.currentConcurrencyMultiplier * 100).toFixed(0)}% due to rate limit errors\n`
      );
    }
  }

  /**
   * Gradually recover concurrency if no rate limits for a while
   */
  private recoverConcurrency(): void {
    const now = Date.now();
    const timeSinceLastRateLimit = now - this.lastRateLimitTime;
    
    // If no rate limits for recovery window, gradually increase concurrency
    if (
      timeSinceLastRateLimit > this.recoveryWindowMs &&
      this.currentConcurrencyMultiplier < 1.0
    ) {
      const newMultiplier = Math.min(
        1.0,
        this.currentConcurrencyMultiplier * 1.1 // Increase by 10%
      );
      
      if (newMultiplier > this.currentConcurrencyMultiplier) {
        this.currentConcurrencyMultiplier = newMultiplier;
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        process.stdout.write(
          `\n✅ [${timestamp}] [RateLimit] Recovering concurrency to ${(this.currentConcurrencyMultiplier * 100).toFixed(0)}% (no rate limits for ${Math.round(timeSinceLastRateLimit / 1000 / 60)} minutes)\n`
        );
      }
    }
  }

  /**
   * Get the adjusted concurrency multiplier
   */
  getConcurrencyMultiplier(): number {
    this.recoverConcurrency();
    return this.currentConcurrencyMultiplier;
  }

  /**
   * Get recommended delay before starting next attempt (in ms)
   * Returns longer delays if we've had recent rate limits
   */
  getRecommendedDelay(): number {
    const now = Date.now();
    const recentEvents = this.events.filter(
      (event) => now - event.timestamp < 60000 // Last minute
    );
    
    if (recentEvents.length > 0) {
      // If we had rate limits in the last minute, add extra delay
      return 2000 + (recentEvents.length * 1000); // Base 2s + 1s per recent event
    }
    
    return 0; // No extra delay needed
  }

  /**
   * Check if we should retry a rate-limited attempt
   */
  shouldRetryRateLimit(): boolean {
    const now = Date.now();
    const recentEvents = this.events.filter(
      (event) => now - event.timestamp < 60000 // Last minute
    );
    
    // Only retry if we haven't had too many recent rate limits
    return recentEvents.length < 3;
  }

  /**
   * Get retry delay for a rate-limited attempt (exponential backoff)
   */
  getRetryDelay(attemptNumber: number): number {
    // Exponential backoff: 30s, 60s, 120s
    return Math.min(30000 * Math.pow(2, attemptNumber - 1), 120000);
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      currentMultiplier: this.currentConcurrencyMultiplier,
      recentEvents: this.events.length,
      timeSinceLastRateLimit: this.lastRateLimitTime > 0 
        ? Date.now() - this.lastRateLimitTime 
        : null,
    };
  }
}

// Singleton instance
export const rateLimitManager = new RateLimitManager();

