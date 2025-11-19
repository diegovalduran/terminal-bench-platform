# Terminal-Bench Platform

A platform for running and analyzing Terminal-Bench tasks using the Harbor harness. Upload tasks, run Terminus 2 agent multiple times, and view detailed execution results.

## Features

- Upload up to 25 zipped Terminal-Bench tasks concurrently
- Run Terminus 2 agent (GPT-5) with configurable attempts (default: 10)
- Real-time job status updates and queue monitoring
- Detailed episode logs, test results, and error traces
- S3 storage for all artifacts with secure download links
- Adaptive rate limit management
- User-based job queuing (25 active, 25 queued per user)
- Support for 25 concurrent jobs system-wide

## Architecture

- **Frontend**: Next.js 15 (Vercel) - UI and API routes
- **Worker**: Node.js service (EC2) - Job processing with Harbor
- **Database**: PostgreSQL (Neon) - Job metadata and results
- **Storage**: AWS S3 - Task files and Harbor outputs

## Quick Start

### Frontend Setup

1. Install dependencies:
   ```bash
   cd frontend
   npm install
   ```

2. Configure environment variables (`.env.local`):
   ```
   DATABASE_URL=postgresql://...
   S3_BUCKET=your-bucket
   S3_REGION=us-east-2
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   OPENAI_API_KEY=...  # Optional, for Terminus 2
   SITE_PASSWORD=...   # Optional, default: "daiquiri"
   ```

3. Setup database:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```

4. Run development server:
   ```bash
   npm run dev
   ```

### Worker Setup

1. Configure environment variables (`worker/.env.local`):
   ```
   DATABASE_URL=postgresql://...
   S3_BUCKET=your-bucket
   S3_REGION=us-east-2
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   OPENAI_API_KEY=...
   HARBOR_MODEL=gpt-5  # Default model
   MAX_CONCURRENT_JOBS=25
   MAX_CONCURRENT_ATTEMPTS_PER_JOB=10
   ```

2. Start worker:
   ```bash
   cd worker
   npm install
   npm run build
   pm2 start ecosystem.config.cjs
   ```

For detailed EC2 deployment, see [DEPLOYMENT.md](./DEPLOYMENT.md).

## Project Structure

```
terminal-bench-platform/
├── frontend/              # Next.js application
├── worker/                # Worker service
├── shared/                # Shared types and utilities
├── harbor/                # Harbor harness
└── terminal-bench-2/      # Task dataset
```

## Storage

- **S3**: Task uploads (`tasks/`) and Harbor outputs (`results/<job-id>/attempt-<index>/`)
- **Database**: Job metadata, attempt results, episodes, test cases

## Configuration

### Worker Environment Variables

- `MAX_CONCURRENT_JOBS` - System-wide job limit (default: 25)
- `MAX_CONCURRENT_ATTEMPTS_PER_JOB` - Attempts per job (default: 10)
- `HARBOR_MODEL` - LLM model (default: `gpt-5`)
- `HARBOR_TIMEOUT_MS` - Timeout per attempt (default: 1800000 = 30 min)
- `DOCKER_CPUS_PER_CONTAINER` - CPU limit (default: 1)
- `DOCKER_MEMORY_MB_PER_CONTAINER` - Memory limit (default: 384)

## Rate Limit Management

The worker automatically adapts to API rate limits:
- Reduces concurrency when rate limits detected
- Gradually recovers after 10 minutes without errors
- Adds adaptive delays between attempt starts

## License

MIT
