import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";

export interface HarborTrialResult {
  agent_info: {
    name: string;
    model_info?: {
      name: string;
    };
  };
  verifier_result?: {
    rewards: Record<string, number>;
  };
  started_at: string;
  finished_at: string;
}

export interface TrajectoryStep {
  // Legacy format fields
  observation?: string | { results?: Array<{ content?: string }> }; // Can be string (legacy) or object (ATIF)
  thought?: string;
  action?: string;
  command?: string;
  output?: string;
  exit_code?: number;
  // ATIF format (Terminus 2)
  step_id?: number;
  timestamp?: string;
  source?: "system" | "agent";
  message?: string;
  tool_calls?: Array<{
    tool_call_id?: string;
    function_name?: string;
    arguments?: {
      keystrokes?: string;
      duration?: number;
    };
  }>;
  metrics?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost_usd?: number;
  };
}

export interface Trajectory {
  schema_version?: string;
  session_id?: string;
  agent?: {
    name?: string;
    version?: string;
    model_name?: string;
  };
  steps?: TrajectoryStep[];
  observations?: Array<{
    state: string;
    timestamp: string;
  }>;
  actions?: Array<{
    command: string;
    output: string;
    exit_code?: number;
  }>;
}

export interface ParsedEpisode {
  stateAnalysis: string;
  explanation: string;
  commands: Array<{ command: string; output: string; exitCode?: number }>;
}

export interface ParsedTrajectory {
  episodes: ParsedEpisode[];
  totalDurationMs: number;
}

/**
 * Parse trajectory.json or oracle.txt from a Harbor trial directory
 * Supports multiple formats: ATIF (Terminus 2), legacy steps, legacy actions, and Oracle
 */
export async function parseTrajectory(trialDir: string): Promise<ParsedTrajectory> {
  // Check trajectory.json FIRST (Terminus 2 and other LLM agents)
  // This takes priority because it's more structured and accurate
  // Only fall back to oracle.txt if trajectory.json doesn't exist
  const oraclePath = join(trialDir, "agent", "oracle.txt");
  const trajectoryPath = join(trialDir, "agent", "trajectory.json");
  
  try {
    // Try trajectory.json FIRST for real LLM agents (Terminus 2, etc.)
    const trajectoryContent = await readFile(trajectoryPath, "utf-8").catch(() => null);
    
    if (trajectoryContent) {
      // We have trajectory.json, parse it (this is the primary format for Terminus 2)
      // Skip oracle.txt check since trajectory.json takes priority
      const trajectory: Trajectory = JSON.parse(trajectoryContent);
      
      const episodes: ParsedEpisode[] = [];
      
      // Check if this is ATIF format (Terminus 2) - has schema_version and steps with source/message
      const isATIF = trajectory.schema_version && trajectory.steps && Array.isArray(trajectory.steps);
      
      if (isATIF && trajectory.steps) {
        // Parse ATIF format (Terminus 2)
        // Group steps by agent episodes (each agent step with tool_calls is an episode)
        let currentEpisode: ParsedEpisode | null = null;
        
        for (const step of trajectory.steps) {
          // Agent steps contain the analysis/plan and commands
          if (step.source === "agent" && step.message) {
            // Extract analysis and plan from message
            // Message format: "Analysis: ...\nPlan: ..."
            const messageLines = step.message.split('\n');
            let analysis = "";
            let plan = "";
            let inAnalysis = false;
            let inPlan = false;
            
            for (const line of messageLines) {
              if (line.startsWith("Analysis:")) {
                inAnalysis = true;
                inPlan = false;
                analysis = line.replace(/^Analysis:\s*/, "");
              } else if (line.startsWith("Plan:")) {
                inPlan = true;
                inAnalysis = false;
                plan = line.replace(/^Plan:\s*/, "");
              } else if (inAnalysis) {
                analysis += "\n" + line;
              } else if (inPlan) {
                plan += "\n" + line;
              }
            }
            
            // If no explicit Analysis/Plan, use the whole message as explanation
            const explanation = plan || analysis || step.message;
            const stateAnalysis = analysis || "Agent analysis";
            
            // Extract commands from tool_calls
            const commands: Array<{ command: string; output: string; exitCode?: number }> = [];
            if (step.tool_calls && Array.isArray(step.tool_calls)) {
              for (const toolCall of step.tool_calls) {
                if (toolCall.function_name === "bash_command" && toolCall.arguments?.keystrokes) {
                  commands.push({
                    command: toolCall.arguments.keystrokes.trim(),
                    output: "", // Will be filled from next observation step
                    exitCode: undefined,
                  });
                }
              }
            }
            
            // Create new episode
            currentEpisode = {
              stateAnalysis: stateAnalysis.trim() || "Agent analysis",
              explanation: explanation.trim() || "Agent plan",
              commands,
            };
          }
          // Observation steps contain terminal output
          // Check for ATIF observation structure (nested object with results array)
          else if (step.source === "system" && step.observation && typeof step.observation === "object" && !Array.isArray(step.observation) && "results" in step.observation) {
            // Get terminal output from observation
            const obs = step.observation as { results?: Array<{ content?: string }> };
            const terminalOutput = obs.results
              ?.map(r => r.content || "")
              .join("\n")
              .trim() || "";
            
            // If we have a current episode, add output to the last command
            if (currentEpisode && currentEpisode.commands.length > 0) {
              const lastCommand = currentEpisode.commands[currentEpisode.commands.length - 1];
              if (!lastCommand.output) {
                lastCommand.output = terminalOutput;
              } else {
                // If output already exists, append (multiple observations per command)
                lastCommand.output += "\n" + terminalOutput;
              }
            } else if (terminalOutput) {
              // If no current episode but we have output, create a basic episode
              currentEpisode = {
                stateAnalysis: "Terminal output",
                explanation: "System observation",
                commands: [{
                  command: "",
                  output: terminalOutput,
                  exitCode: undefined,
                }],
              };
            }
          }
          
          // If we have a complete episode (with commands and output), add it
          if (currentEpisode && currentEpisode.commands.length > 0) {
            // Check if this episode is complete (has output for at least one command)
            const hasOutput = currentEpisode.commands.some(c => c.output);
            if (hasOutput || step.source === "agent") {
              // Only add episode if it has meaningful content
              if (currentEpisode.stateAnalysis || currentEpisode.explanation || currentEpisode.commands.length > 0) {
                episodes.push(currentEpisode);
                currentEpisode = null; // Reset for next episode
              }
            }
          }
        }
        
        // Add final episode if it exists
        if (currentEpisode && (currentEpisode.commands.length > 0 || currentEpisode.stateAnalysis || currentEpisode.explanation)) {
          episodes.push(currentEpisode);
        }
        
        // Return early since we successfully parsed trajectory.json
        return {
          episodes: episodes.length > 0 ? episodes : [{
            stateAnalysis: "No detailed trajectory available",
            explanation: "Agent completed execution",
            commands: [],
          }],
          totalDurationMs: 0,
        };
      }
      // Legacy format: steps-based trajectory (simple format)
      else if (trajectory.steps && Array.isArray(trajectory.steps)) {
        for (const step of trajectory.steps) {
          const commands: Array<{ command: string; output: string; exitCode?: number }> = [];
          
          if (step.command) {
            commands.push({
              command: step.command,
              output: step.output || "",
              exitCode: step.exit_code,
            });
          }
          
          // Handle observation (can be string or object)
          const observationText = typeof step.observation === "string" 
            ? step.observation 
            : "No observation recorded";
          
          episodes.push({
            stateAnalysis: observationText,
            explanation: step.thought || step.action || "Agent action",
            commands,
          });
        }
      }
      // Legacy format: action-based trajectory
      else if (trajectory.actions && Array.isArray(trajectory.actions)) {
        for (const action of trajectory.actions) {
          episodes.push({
            stateAnalysis: "Command execution",
            explanation: `Executed: ${action.command}`,
            commands: [{
              command: action.command,
              output: action.output || "",
              exitCode: action.exit_code,
            }],
          });
        }
      }
      
      return {
        episodes: episodes.length > 0 ? episodes : [{
          stateAnalysis: "No detailed trajectory available",
          explanation: "Agent completed execution",
          commands: [],
        }],
        totalDurationMs: 0,
      };
    }
    
    // Only check oracle.txt if trajectory.json doesn't exist
    // This ensures Terminus 2 output takes priority over any leftover oracle.txt files
    const oracleContent = await readFile(oraclePath, "utf-8").catch(() => null);
    if (oracleContent && oracleContent.trim().length > 0) {
      // Only treat as Oracle if file has actual content (not empty)
      console.log(`[Worker] Found oracle.txt (no trajectory.json), parsing Oracle agent output`);
      return {
        episodes: [{
          stateAnalysis: "Oracle agent execution",
          explanation: "Oracle agent knows the solution and executes it directly",
          commands: [{
            command: "oracle",
            output: oracleContent, // Full oracle.txt content
            exitCode: 0,
          }],
        }],
        totalDurationMs: 0,
      };
    }
    
    // Neither trajectory.json nor oracle.txt exists (or oracle.txt is empty)
    // Add diagnostic logging to understand why
    const agentDir = join(trialDir, "agent");
    const agentDirExists = await stat(agentDir).then(() => true).catch(() => false);
    
    let diagnosticMessage = "Agent output files not found";
    
    if (!agentDirExists) {
      console.log(`[Worker] Agent directory missing - agent may not have run`);
      diagnosticMessage = "Agent directory not found - agent may have crashed before creating output files";
    } else {
      // Check if directory is empty
      try {
        const agentFiles = await readdir(agentDir);
        if (agentFiles.length === 0) {
          console.log(`[Worker] Agent directory is empty - agent may have crashed before writing files`);
          diagnosticMessage = "Agent directory exists but is empty - agent may have crashed before creating trajectory files";
        } else {
          console.log(`[Worker] Agent directory exists with ${agentFiles.length} file(s): ${agentFiles.join(', ')}`);
          diagnosticMessage = "Trajectory files not found - agent may have timed out or crashed before completing execution";
        }
      } catch (error) {
        console.log(`[Worker] Error reading agent directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
        diagnosticMessage = "Agent directory exists but could not be read";
      }
    }
    
    console.log(`[Worker] No trajectory file found (neither trajectory.json nor valid oracle.txt)`);
    return {
      episodes: [{
        stateAnalysis: "Agent execution incomplete",
        explanation: diagnosticMessage,
        commands: [],
      }],
      totalDurationMs: 0,
    };
  } catch (error) {
    console.error(`[Worker] Failed to parse trajectory:`, error);
    // Return fallback episode if trajectory parsing fails
    return {
      episodes: [{
        stateAnalysis: "Trajectory parsing failed",
        explanation: "Could not extract detailed agent actions",
        commands: [],
      }],
      totalDurationMs: 0,
    };
  }
}

