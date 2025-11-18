# Worker Service Documentation

## Overview

The worker service is a standalone Node.js process that polls the database for queued jobs and processes them using the job queue. It runs independently from the Next.js application.

## Architecture

- **Database Polling**: The worker polls the database every 5 seconds (configurable) for jobs with status `"queued"`
- **Job Queue**: Jobs are enqueued to an in-memory queue that handles:
  - User-based job limits (1 active job per user, max 5 queued per user)
  - System-wide concurrency limits (max 5 concurrent jobs)
  - Fair scheduling across users
- **Parallel Execution**: Each job runs up to 10 attempts in parallel using semaphore-based concurrency control

## Running the Worker

### Development

```bash
npm run worker
```

This uses `tsx` to run TypeScript directly without compilation.

### Production

#### Option 1: Using PM2 (Recommended)

```bash
# Install PM2 globally (if not already installed)
npm install -g pm2

# Start the worker
pm2 start ecosystem.config.js

# View logs
pm2 logs terminal-bench-worker

# Monitor
pm2 monit

# Stop the worker
pm2 stop terminal-bench-worker

# Restart the worker
pm2 restart terminal-bench-worker

# View status
pm2 status
```

#### Option 2: Direct Node.js

```bash
# Build the worker
npm run worker:build

# Run the compiled worker
npm run worker:prod
```

## Environment Variables

The worker requires the same environment variables as the Next.js application:

- `DATABASE_URL` - PostgreSQL connection string (required)
- `S3_BUCKET` - S3 bucket name (required)
- `S3_REGION` - AWS region (required)
- `S3_ACCESS_KEY_ID` - AWS access key (required)
- `S3_SECRET_ACCESS_KEY` - AWS secret key (required)
- `OPENAI_API_KEY` - OpenAI API key (optional, for Terminus 2 agent)
- `WORKER_POLL_INTERVAL_MS` - Poll interval in milliseconds (default: 5000)
- `MAX_CONCURRENT_ATTEMPTS_PER_JOB` - Max parallel attempts per job (default: 10)

## Graceful Shutdown

The worker handles graceful shutdown on `SIGTERM` and `SIGINT` signals:

1. Stops polling for new jobs
2. Waits for running jobs to complete (max 30 seconds)
3. Closes database connections
4. Exits cleanly

## Logging

The worker uses structured logging with the following log levels:

- `debug` - Detailed information (only in development)
- `info` - General information about worker operations
- `warn` - Warning messages
- `error` - Error messages with stack traces

Logs are written to:
- Console (stdout/stderr)
- PM2 log files (if using PM2): `logs/worker-out.log` and `logs/worker-error.log`

## Monitoring

### Health Check

The worker doesn't expose an HTTP endpoint, but you can monitor it through:

1. **PM2 Status**: `pm2 status` shows if the worker is running
2. **Database**: Check for jobs with status `"running"` to see active jobs
3. **Logs**: Monitor logs for errors or warnings

### Metrics to Monitor

- Job processing rate
- Queue length
- Failed jobs
- Worker uptime
- Memory usage
- Error rate

## Troubleshooting

### Worker not processing jobs

1. Check if worker is running: `pm2 status` or check process list
2. Verify database connection: Check logs for connection errors
3. Check for queued jobs: Query database for jobs with status `"queued"`
4. Verify environment variables are set correctly

### Jobs stuck in "queued" status

1. Check worker logs for errors
2. Verify job queue limits aren't preventing enqueueing
3. Check if user has reached queue limits (max 5 queued per user)
4. Verify system-wide concurrency limit (max 5 concurrent jobs)

### High memory usage

- PM2 will automatically restart if memory exceeds 2GB
- Check for memory leaks in job processing
- Consider reducing `MAX_CONCURRENT_ATTEMPTS_PER_JOB` if needed

## Deployment

### EC2 Deployment

1. SSH into EC2 instance
2. Clone repository
3. Install dependencies: `npm install`
4. Set up environment variables in `.env.local`
5. Start worker with PM2: `pm2 start ecosystem.config.js`
6. Set PM2 to start on boot: `pm2 startup` and follow instructions

### Docker Deployment (Future)

The worker can be containerized and run as a separate service alongside the Next.js application.

