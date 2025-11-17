#!/bin/bash

# Script to run a Terminal-Bench 2 task locally using Harbor
# Usage: ./run_task_local.sh <task_name>

set -e

TASK_NAME=${1:-"build-cython-ext"}
TASK_DIR="./terminal-bench-2/${TASK_NAME}"
OUTPUT_DIR="./runs"

echo "=========================================="
echo "Running Terminal-Bench 2 Task Locally"
echo "=========================================="
echo "Task: ${TASK_NAME}"
echo "Task Directory: ${TASK_DIR}"
echo "Output Directory: ${OUTPUT_DIR}"
echo ""

# Check if task directory exists
if [ ! -d "$TASK_DIR" ]; then
    echo "Error: Task directory not found: ${TASK_DIR}"
    exit 1
fi

# Check if Harbor is installed
if ! command -v harbor &> /dev/null; then
    echo "Error: Harbor is not installed. Please install it first."
    exit 1
fi

echo "Running task with oracle agent (no API key required)..."
echo ""

# Run the task using Harbor
# Using oracle agent which doesn't require API keys
# Using local path to run a single task
harbor run \
    --path "${TASK_DIR}" \
    --agent oracle \
    --env docker \
    --jobs-dir "${OUTPUT_DIR}" \
    --n-concurrent 1 \
    --quiet

echo ""
echo "=========================================="
echo "Task execution completed!"
echo "Check output in: ${OUTPUT_DIR}"
echo "=========================================="

