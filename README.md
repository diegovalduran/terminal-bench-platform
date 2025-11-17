# Terminal-Bench Platform

A platform for running and analyzing Terminal-Bench tasks using the Harbor harness (Terminal-Bench 2).

## Goal 1: Run Locally ✅

**Status**: Complete

Run 1 terminal bench task locally using bash commands via Harbor and analyze the output of the run, where it saves, and the running process.

## Goal 2: Scoring and Observability 🚧

**Status**: MVP Complete - Ready for Testing

Build a hosted application where users can:
- Upload zipped Terminal-Bench tasks
- Run Terminus 2 agent multiple times (configurable, default 10)
- View live updates of agent execution
- Inspect detailed logs, episodes, and test results

### Progress

✅ **Frontend Scaffold**: Next.js 15 + Tailwind + shadcn/ui  
✅ **Database Schema**: PostgreSQL with Drizzle ORM (jobs, attempts, episodes)  
✅ **File Upload**: Multipart upload handler + job creation  
✅ **Worker Pipeline**: Harbor execution with task unzipping and output parsing  
✅ **Live UI Updates**: SWR polling for real-time job/attempt status  
✅ **Error Handling**: Toast notifications and loading states  
✅ **Trajectory Parsing**: Extract detailed episodes from agent logs  
⏳ **Integration Testing**: Need database + OpenAI API key to test end-to-end

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

2. **Setup database**:
   ```bash
   # Create a PostgreSQL database (local or hosted like Supabase/Neon)
   # Copy env.template to .env.local and update DATABASE_URL
   cp env.template .env.local
   
   # Generate and run migrations
   npm run db:generate
   npm run db:migrate
   ```

3. **Run development server**:
   ```bash
   npm run dev
   ```

4. **Access the app**:
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

## Output Structure

Results are saved in `runs/<job-id>/`:
- `result.json`: Job summary and statistics
- `trials/<trial-id>/`: Individual trial results
  - `result.json`: Trial result with agent and verifier info
  - `agent/`: Agent logs and trajectories
  - `verifier/`: Test results and rewards

See `GOAL1_ANALYSIS.md` for detailed output structure documentation.

