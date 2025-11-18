/**
 * Semaphore implementation for controlling concurrent execution
 * Limits the number of concurrent operations to a specified maximum
 */
export class Semaphore {
  private permits: number;
  private waiters: Array<() => void> = [];

  constructor(permits: number) {
    if (permits < 1) {
      throw new Error("Semaphore must have at least 1 permit");
    }
    this.permits = permits;
  }

  /**
   * Acquire a permit. If no permits are available, wait until one is released.
   * @returns Promise that resolves when a permit is acquired
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    // No permits available, wait for one to be released
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /**
   * Release a permit. If there are waiters, wake one up.
   */
  release(): void {
    if (this.waiters.length > 0) {
      // Wake up the first waiter
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter();
      }
    } else {
      // No waiters, just increment permits
      this.permits++;
    }
  }

  /**
   * Execute a function with a semaphore permit
   * Automatically acquires and releases the permit
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Get the number of available permits
   */
  getAvailablePermits(): number {
    return this.permits;
  }

  /**
   * Get the number of waiters
   */
  getWaitersCount(): number {
    return this.waiters.length;
  }
}

