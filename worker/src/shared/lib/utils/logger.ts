/**
 * Log a message immediately to stdout with emoji and timestamp
 * This ensures logs are visible in real-time, especially important for worker processes
 */
export function logImmediate(emoji: string, message: string, ...args: any[]): void {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  process.stdout.write(`\n${emoji} [${timestamp}] [Worker] ${message}${args.length > 0 ? ' ' + args.map(String).join(' ') : ''}\n`);
}

