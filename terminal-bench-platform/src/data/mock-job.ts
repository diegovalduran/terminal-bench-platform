import { JobSummary } from "@/types/runs";

export const mockJob: JobSummary = {
  id: "job-sample-001",
  taskName: "build-cython-ext",
  status: "running",
  runsRequested: 10,
  runsCompleted: 4,
  createdAt: new Date().toISOString(),
  attempts: [
    {
      id: "attempt-0",
      index: 0,
      status: "success",
      testsPassed: 8,
      testsTotal: 8,
      startedAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
      finishedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
      rewardSummary: {
        test_outputs_exist_and_perms: 1,
        test_ascii_lf_newline_tabs_trailing: 1,
        test_csv_header_and_no_spaces_anywhere: 1,
        test_csv_schema_and_types: 1,
        test_reference_equality_and_sorting: 1,
        test_filtering_threshold: 1,
        test_latest_symlink_target_is_absolute: 1,
        test_manifest_format_and_hashes: 1,
      },
      logPath: "/runs/job-sample-001/attempt-0/trial.log",
      episodes: [
        {
          id: "episode-0",
          index: 0,
          stateAnalysis:
            "We are at the shell prompt in /app as root. No outputs have been produced yet, instructions describe parsing graph edge files.",
          explanation:
            "Create and run a Python script that reads .edge/.edge.gz files, validates, filters, writes CSV summaries, manifests, and symlink.",
          commands: [
            {
              command: "ls",
              output: "data  instruction.md  solution  tests",
            },
            {
              command: "cat instruction.md",
              output: "(truncated instructions...)",
            },
          ],
          durationMs: 90_000,
        },
        {
          id: "episode-1",
          index: 1,
          stateAnalysis:
            "Script executed, generated hourly_components.csv, latest.csv, manifest. Need to validate tests run.",
          explanation:
            "Inspect outputs, ensure permissions, run tests, gather logs.",
          commands: [
            {
              command: "pytest tests/test_outputs.py",
              output: "8 passed in 120.34s",
            },
          ],
          durationMs: 45_000,
        },
      ],
    },
    {
      id: "attempt-1",
      index: 1,
      status: "failed",
      testsPassed: 0,
      testsTotal: 8,
      startedAt: new Date(Date.now() - 1000 * 60 * 11).toISOString(),
      finishedAt: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
      rewardSummary: {
        test_outputs_exist_and_perms: 0,
      },
      logPath: "/runs/job-sample-001/attempt-1/trial.log",
      episodes: [
        {
          id: "episode-2",
          index: 0,
          stateAnalysis:
            "Script crashed due to missing numpy wheels. Need to inspect environment and retry.",
          explanation:
            "Check python version, pip install dependencies, rerun script.",
          commands: [
            {
              command: "python run.py",
              output: "ImportError: No module named numpy",
            },
          ],
        },
      ],
    },
  ],
};
