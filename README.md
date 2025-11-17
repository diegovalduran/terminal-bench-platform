# Terminal-Bench Platform

A platform for running and analyzing Terminal-Bench tasks using the Harbor harness (Terminal-Bench 2).

## Goal 1: Run Locally 

**Status**: Setup complete! Ready to run tasks once Docker is installed.

Run 1 terminal bench task locally using bash commands via Harbor and analyze the output of the run, where it saves, and the running process.

### What's Been Done

✅ **Project Structure**: Created and organized  
✅ **Harbor Installed**: Harbor harness installed and configured  
✅ **Terminal-Bench 2 Tasks**: Cloned repository with all tasks  
✅ **Documentation**: Created comprehensive setup and analysis guides  
✅ **Run Script**: Created script to easily run tasks locally  
✅ **Output Analysis**: Documented output structure and analysis methods  

### Next Step

**Install Docker** to run tasks:
- macOS: `brew install --cask docker` or download from [docker.com](https://www.docker.com/products/docker-desktop/)
- Then run: `./run_task_local.sh build-cython-ext`

## Prerequisites

- ✅ Python 3.12+ (installed)
- ⏳ Docker (required for containerized task execution)
- ✅ Git (installed)
- ✅ Harbor (installed)

## Quick Start

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

