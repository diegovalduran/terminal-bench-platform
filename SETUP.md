# Setup Guide for Terminal-Bench Platform

## Prerequisites

### Required
- **Python 3.12+** - Already installed ✓
- **Docker** - Required for running tasks in containerized environments
- **Git** - Already installed ✓

### Optional
- **uv** - Python package manager (can use pip instead)

## Installation Steps

### 1. Install Docker

Docker is required for Harbor to run tasks in isolated containerized environments.

**macOS:**
```bash
# Install Docker Desktop for Mac
# Download from: https://www.docker.com/products/docker-desktop/
# Or use Homebrew:
brew install --cask docker
```

**Verify Docker installation:**
```bash
docker --version
docker ps  # Should not error
```

### 2. Install Harbor

Harbor is already cloned and installed in this project. If you need to reinstall:

```bash
cd harbor
pip3 install -e .
```

Verify installation:
```bash
harbor --help
```

### 3. Verify Terminal-Bench 2 Tasks

The Terminal-Bench 2 tasks repository is already cloned. You can see available tasks in the `terminal-bench-2/` directory.

## Running a Task Locally

### Using the Script

```bash
./run_task_local.sh <task_name>
```

Example:
```bash
./run_task_local.sh build-cython-ext
```

### Using Harbor Directly

#### Run with Oracle Agent (No API Key Required)

The oracle agent uses the solution scripts provided with tasks, so it doesn't need an API key:

```bash
harbor run \
    --path ./terminal-bench-2/build-cython-ext \
    --agent oracle \
    --env docker \
    --jobs-dir ./runs \
    --n-concurrent 1
```

#### Run with Terminus 2 Agent (Requires API Key)

For running with an actual AI agent using GPT-5:

```bash
export OPENAI_API_KEY=<YOUR-API-KEY>
harbor run \
    --path ./terminal-bench-2/build-cython-ext \
    --agent terminus-2 \
    --model gpt-5 \
    --env docker \
    --jobs-dir ./runs \
    --n-concurrent 1
```

### Command Options

- `--path` or `-p`: Path to a local task directory
- `--agent` or `-a`: Agent to use (oracle, terminus-2, etc.)
- `--model` or `-m`: Model name (required for some agents)
- `--env` or `-e`: Environment type (docker, daytona, e2b, modal, runloop)
- `--jobs-dir` or `-o`: Directory to store job results (default: `./jobs`)
- `--n-concurrent` or `-n`: Number of concurrent trials (default: 4)
- `--task-name` or `-t`: Task name to include (supports glob patterns)
- `--quiet` or `-q`: Suppress individual trial progress displays

## Understanding the Output Structure

### Job Directory Structure

When you run a task, Harbor creates a job directory (default: `./jobs/` or specified with `--jobs-dir`):

```
jobs/
└── <job-id>/                    # Unique job identifier (timestamp-based)
    ├── config.json              # Job configuration
    ├── result.json              # Job results summary
    ├── job.log                  # Job-level logs
    └── trials/                  # Individual trial results
        └── <trial-id>/          # Unique trial identifier
            ├── config.json      # Trial configuration
            ├── result.json      # Trial result (TrialResult)
            ├── trial.log        # Trial execution logs
            ├── exception.txt    # Exception message (if any)
            ├── agent/           # Agent logs and outputs
            │   └── ...          # Agent-specific logs (trajectories, etc.)
            └── verifier/        # Verifier logs and test results
                ├── test-stdout.txt    # Test script stdout
                ├── test-stderr.txt    # Test script stderr
                ├── reward.txt         # Reward value (float)
                └── reward.json        # Reward details (JSON)
```

### Key Files to Analyze

1. **`result.json`** (Job level): Overall job statistics and summary
2. **`trials/<trial-id>/result.json`**: Individual trial results including:
   - Agent information
   - Task information
   - Verifier results (test pass/fail, rewards)
   - Timing information
   - Exception information (if any)

3. **`trials/<trial-id>/verifier/reward.json`**: Detailed reward information
   - Contains test results and pass/fail information
   - Format: `{"test_name": reward_value, ...}`

4. **`trials/<trial-id>/agent/`**: Agent execution logs
   - Trajectories (if agent saves them)
   - Debug logs
   - Agent-specific outputs

5. **`trials/<trial-id>/verifier/test-stdout.txt`**: Test script output
   - Shows what tests were run
   - Test execution output

6. **`trials/<trial-id>/trial.log`**: Complete trial execution log

### Analyzing Results

#### Check Job Summary

```bash
cat jobs/<job-id>/result.json | python3 -m json.tool
```

#### Check Individual Trial Results

```bash
cat jobs/<job-id>/trials/<trial-id>/result.json | python3 -m json.tool
```

#### Check Test Results

```bash
# View reward information
cat jobs/<job-id>/trials/<trial-id>/verifier/reward.json

# View test output
cat jobs/<job-id>/trials/<trial-id>/verifier/test-stdout.txt
```

#### Check Agent Logs

```bash
# List agent log files
ls -la jobs/<job-id>/trials/<trial-id>/agent/

# View agent trajectory (if available)
cat jobs/<job-id>/trials/<trial-id>/agent/trajectory.json
```

## Understanding Trial Results

### TrialResult Structure

The `result.json` file in each trial directory contains a `TrialResult` object with:

- **`trial_name`**: Unique trial identifier
- **`task_name`**: Name of the task
- **`task_id`**: Task identifier
- **`started_at`**: When the trial started
- **`finished_at`**: When the trial finished
- **`agent_info`**: Information about the agent used
  - `name`: Agent name
  - `model_info`: Model information (if applicable)
- **`agent_result`**: Agent execution results
  - `trajectory`: Steps taken by the agent
  - `timing`: Timing information
- **`verifier_result`**: Test verification results
  - `rewards`: Dictionary of test names to reward values
  - `timing`: Verification timing
- **`exception_info`**: Exception information (if trial failed)
- **`trial_uri`**: Path to trial directory

### Reward System

- Rewards are typically `1.0` for passing tests and `0.0` for failing tests
- Some tasks may have partial rewards
- Check `verifier/reward.json` for detailed reward breakdown

## Example: Analyzing a Completed Run

```bash
# 1. Find the latest job
LATEST_JOB=$(ls -t jobs/ | head -1)

# 2. View job summary
cat jobs/$LATEST_JOB/result.json | python3 -m json.tool

# 3. List all trials
ls jobs/$LATEST_JOB/trials/

# 4. Check a specific trial
TRIAL_ID=$(ls jobs/$LATEST_JOB/trials/ | head -1)
cat jobs/$LATEST_JOB/trials/$TRIAL_ID/result.json | python3 -m json.tool

# 5. Check test results
cat jobs/$LATEST_JOB/trials/$TRIAL_ID/verifier/reward.json

# 6. View test output
cat jobs/$LATEST_JOB/trials/$TRIAL_ID/verifier/test-stdout.txt
```

## Troubleshooting

### Docker Issues

If you get Docker-related errors:
1. Ensure Docker is running: `docker ps`
2. Check Docker permissions
3. Try: `docker pull <image-name>` to pre-download images

### Task Not Found

If Harbor can't find the task:
- Verify the path is correct
- Ensure the task directory contains `task.toml`
- Check that you're using the correct task name

### API Key Issues

For agents requiring API keys:
- Set environment variable: `export OPENAI_API_KEY=<key>`
- Or use `.env` file with `python-dotenv`

## Next Steps

Once you can run tasks locally and understand the output structure, you can:
1. Run multiple trials of the same task
2. Compare different agents/models
3. Analyze agent trajectories
4. Build the platform to upload and run tasks via web interface

