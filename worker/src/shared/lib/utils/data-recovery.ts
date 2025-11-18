import { readFile } from "fs/promises";
import { join } from "path";
import { createEpisode } from "../attempt-service.js";
import { uploadDirectory } from "../s3-service.js";
import { findLatestHarborOutput, findTrialDirectory } from "./file-utils.js";
import { parseTrajectory, HarborTrialResult } from "./trajectory-parser.js";
import { logImmediate } from "./logger.js";

/**
 * Attempts to recover partial data from a failed attempt
 * This allows users to see what was done before the error occurred
 */
export async function recoverPartialData(
  attemptId: string,
  attemptOutputDir: string,
  attemptIndex: number,
  jobId: string
): Promise<{
  episodesFound: number;
  testsPassed: number;
  testsTotal: number;
  testCases: Array<{ name: string; status: string; trace?: string; message?: string }>;
  s3Url: string | null;
}> {
  const result = {
    episodesFound: 0,
    testsPassed: 0,
    testsTotal: 0,
    testCases: [] as Array<{ name: string; status: string; trace?: string; message?: string }>,
    s3Url: null as string | null,
  };

  try {
    // Try to find the latest run directory (even if Harbor didn't complete)
    const latestRunDir = await findLatestHarborOutput(attemptOutputDir).catch(() => null);
    if (!latestRunDir) {
      logImmediate('⚠️', `No Harbor output directory found for partial data recovery`);
      return result;
    }

    const trialDir = await findTrialDirectory(latestRunDir).catch(() => null);
    if (!trialDir) {
      logImmediate('⚠️', `No trial directory found for partial data recovery`);
      return result;
    }

    logImmediate('🔍', `Attempting to recover partial data from ${trialDir}`);

    // Try to parse partial trajectory.json
    try {
      const { episodes } = await parseTrajectory(trialDir);
      if (episodes.length > 0) {
        logImmediate('📚', `Found ${episodes.length} partial episodes in trajectory`);
        
        // Create episodes from partial trajectory
        for (let i = 0; i < episodes.length; i++) {
          try {
            await createEpisode({
              attemptId,
              index: i,
              stateAnalysis: episodes[i].stateAnalysis,
              explanation: episodes[i].explanation,
              commands: episodes[i].commands,
              durationMs: undefined,
            });
            result.episodesFound++;
          } catch (episodeError) {
            // Ignore individual episode creation errors
            logImmediate('⚠️', `Failed to create episode ${i}: ${episodeError instanceof Error ? episodeError.message : 'Unknown error'}`);
          }
        }
      }
    } catch (trajectoryError) {
      logImmediate('⚠️', `Failed to parse trajectory: ${trajectoryError instanceof Error ? trajectoryError.message : 'Unknown error'}`);
    }

    // Try to parse partial test results
    try {
      // Try ctrf.json first (structured format)
      const ctrfPath = join(trialDir, "verifier", "ctrf.json");
      const ctrfContent = await readFile(ctrfPath, "utf-8").catch(() => null);

      if (ctrfContent) {
        try {
          const ctrf = JSON.parse(ctrfContent);
          if (ctrf.results?.summary) {
            result.testsPassed = ctrf.results.summary.passed || 0;
            result.testsTotal = ctrf.results.summary.tests || 0;
          }
          if (ctrf.results?.tests && Array.isArray(ctrf.results.tests)) {
            result.testCases = ctrf.results.tests.map((test: any) => ({
              name: test.name || "Unknown test",
              status: test.status || "unknown",
              trace: test.trace,
              message: test.message,
            }));
          }
          logImmediate('🧪', `Found partial test results: ${result.testsPassed}/${result.testsTotal} passed`);
        } catch (parseError) {
          // Ignore parse errors
        }
      }

      // Fallback to result.json if ctrf.json not available
      if (result.testsTotal === 0) {
        try {
          const resultPath = join(trialDir, "result.json");
          const resultContent = await readFile(resultPath, "utf-8");
          const harborResult: HarborTrialResult = JSON.parse(resultContent);
          const rewards = harborResult.verifier_result?.rewards || {};
          result.testsPassed = Object.values(rewards).filter((r) => r === 1).length;
          result.testsTotal = Object.keys(rewards).length || 0;
          if (result.testsTotal > 0) {
            logImmediate('🧪', `Found partial test results from result.json: ${result.testsPassed}/${result.testsTotal} passed`);
          }
        } catch (resultError) {
          // Ignore parse errors
        }
      }
    } catch (testError) {
      logImmediate('⚠️', `Failed to parse test results: ${testError instanceof Error ? testError.message : 'Unknown error'}`);
    }

    // Try to upload whatever files exist to S3
    try {
      const s3Prefix = `results/${jobId}/attempt-${attemptIndex}/`;
      await uploadDirectory(trialDir, s3Prefix);
      result.s3Url = `s3://${process.env.S3_BUCKET}/${s3Prefix}`;
      logImmediate('☁️', `Uploaded partial files to S3: ${result.s3Url}`);
    } catch (uploadError) {
      logImmediate('⚠️', `Failed to upload partial files: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`);
    }

    if (result.episodesFound > 0 || result.testsTotal > 0 || result.s3Url) {
      logImmediate('✅', `Partial data recovery successful: ${result.episodesFound} episodes, ${result.testsPassed}/${result.testsTotal} tests, S3: ${result.s3Url ? 'yes' : 'no'}`);
    } else {
      logImmediate('ℹ️', `No partial data found to recover`);
    }
  } catch (error) {
    // Don't throw - recovery is best effort
    logImmediate('⚠️', `Partial data recovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return result;
}

