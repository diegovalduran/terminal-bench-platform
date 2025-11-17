# Terminal-Bench Platform

A platform for running and analyzing Terminal-Bench tasks using the Harbor harness (Terminal-Bench 2).

## Goal 1: Run Locally ✅

**Status**: Complete

Run 1 terminal bench task locally using bash commands via Harbor and analyze the output of the run, where it saves, and the running process.

## Goal 2: Scoring and Observability ✅

**Status**: Complete - Production Ready

Build a hosted application where users can:
- Upload zipped Terminal-Bench tasks
- Run Terminus 2 agent multiple times (configurable, default 10)
- View live updates of agent execution
- Inspect detailed logs, episodes, and test results
- Download artifacts from S3 storage

### Progress

✅ **Frontend Scaffold**: Next.js 15 + Tailwind + shadcn/ui  
✅ **Database Schema**: PostgreSQL with Drizzle ORM (jobs, attempts, episodes)  
✅ **File Upload**: Multipart upload handler + job creation  
✅ **Worker Pipeline**: Harbor execution with task unzipping and output parsing  
✅ **Live UI Updates**: SWR polling for real-time job/attempt status  
✅ **Error Handling**: Toast notifications and loading states  
✅ **Trajectory Parsing**: Extract detailed episodes from agent logs  
✅ **S3 Object Storage**: Task uploads and Harbor outputs stored in S3  
✅ **Signed URL Downloads**: Secure time-limited access to artifacts  
✅ **End-to-End Testing**: Verified with Oracle agent (Terminus 2 ready when API key available)

## Goal 3: Run Persistence and Comparison 🚧

**Status**: Core Features Complete

Enable multiple users to upload and run multiple tasks concurrently without interference.

### Progress

✅ **Concurrent Job Processing**: Queue supports up to 5 simultaneous jobs  
✅ **Job Isolation**: Each job has isolated work directories and file storage  
✅ **Queue Status UI**: Real-time display of running/queued jobs  
✅ **Database Persistence**: All runs stored with full history  
✅ **User Schema**: Database ready for multi-user support  
⏳ **User Authentication**: Not yet implemented  
⏳ **Comparison UI**: Need clarification on requirements

## Prerequisites

- ✅ Python 3.12+ (installed)
- ⏳ Docker (required for containerized task execution)
- ✅ Git (installed)
- ✅ Harbor (installed)
- ⏳ PostgreSQL (for Goal 2 web app)
- ⏳ Node.js 18+ (for Goal 2 web app)

## Quick Start

### Goal 1: Local CLI Runs

1. **Install Docker** (see `SETUP.md` for details)
2. **Run a task**:
   ```bash
   ./run_task_local.sh build-cython-ext
   ```
3. **Analyze results**:
   ```bash
   # View job results
   cat runs/<job-id>/result.json | python3 -m json.tool
   
   # View trial results
   cat runs/<job-id>/trials/<trial-id>/result.json | python3 -m json.tool
   ```

### Goal 2: Web Application

1. **Install dependencies**:
   ```bash
   cd frontend
   npm install
   ```

2. **Setup environment variables**:
   ```bash
   # Copy env.template to .env.local
   cp env.template .env.local
   
   # Update .env.local with your configuration:
   # - DATABASE_URL: PostgreSQL connection string (e.g., Neon, Supabase)
   # - S3_BUCKET: Your S3 bucket name
   # - S3_REGION: AWS region (e.g., us-east-2)
   # - S3_ACCESS_KEY_ID: AWS access key
   # - S3_SECRET_ACCESS_KEY: AWS secret key
   # - OPENAI_API_KEY: (Optional) For Terminus 2 agent
   ```

3. **Setup database**:
   ```bash
   # Generate and run migrations
   npm run db:generate
   npm run db:migrate
   ```

4. **Setup S3 bucket**:
   ```bash
   # Create an S3 bucket in AWS Console
   # Create an IAM user with S3FullAccess permissions
   # Add credentials to .env.local (see step 2)
   ```

5. **Run development server**:
   ```bash
   npm run dev
   ```

6. **Access the app**:
   Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
terminal-bench-platform/
├── README.md              # This file
├── SETUP.md               # Detailed setup and usage guide
├── GOAL1_ANALYSIS.md      # Analysis of execution process and outputs
├── run_task_local.sh      # Script to run tasks locally
├── requirements.txt       # Python dependencies
├── harbor/                # Harbor harness (cloned and installed)
├── terminal-bench-2/      # Terminal-Bench 2 tasks (cloned)
└── runs/                  # Output directory for task runs
```

## Documentation

- **`SETUP.md`**: Complete setup guide, running tasks, understanding outputs
- **`GOAL1_ANALYSIS.md`**: Deep dive into execution process, output structure, and analysis

## Running Tasks

### Using the Script

```bash
./run_task_local.sh <task_name>
```

### Using Harbor Directly

```bash
# With oracle agent (no API key needed)
harbor run \
    --path ./terminal-bench-2/build-cython-ext \
    --agent oracle \
    --env docker \
    --jobs-dir ./runs

# With Terminus 2 agent (requires API key)
export OPENAI_API_KEY=<your-key>
harbor run \
    --path ./terminal-bench-2/build-cython-ext \
    --agent terminus-2 \
    --model gpt-5 \
    --env docker \
    --jobs-dir ./runs
```

## Storage Structure

### Local Storage (Temporary)
Local work directories are created temporarily during job processing and cleaned up after artifacts are uploaded to S3:
- `frontend/work/<job-id>/`: Temporary extraction and Harbor execution directory (auto-cleaned)

### S3 Storage (Permanent)
All artifacts are stored in S3 for persistence and scalability:

**Task Uploads:**
- `s3://<bucket>/tasks/<timestamp>-<task-name>.zip`

**Harbor Outputs:**
- `s3://<bucket>/results/<job-id>/attempt-<index>/`
  - `config.json`: Trial configuration
  - `result.json`: Trial results with test scores
  - `trial.log`: Execution logs
  - `agent/`: Agent logs (trajectory.json or oracle.txt)
  - `verifier/`: Test outputs and reward files

### Database
Job metadata and attempt summaries are stored in PostgreSQL:
- `jobs`: Job status, task name, S3 URLs
- `attempts`: Test results, S3 log paths, reward summaries
- `episodes`: Detailed agent actions and commands

See `GOAL1_ANALYSIS.md` for detailed output structure documentation.

