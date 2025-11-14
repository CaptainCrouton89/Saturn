import { traceable } from "langsmith/traceable";

type AgentType = "conversation" | "ingestion" | "evaluator";

interface TracingOptions {
  phase?: string;
  userId?: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Wrapper for traceable that auto-tags agent functions
 * Simplifies tracing setup across agent entry points
 */
export function withAgentTracing(
  fn: (...args: unknown[]) => unknown,
  agentType: AgentType,
  options?: TracingOptions
): (...args: unknown[]) => unknown {
  const tags = [agentType, "agent"];
  if (options?.phase) tags.push(options.phase);

  const metadata: Record<string, string | number | boolean> = {
    agentType,
    timestamp: new Date().toISOString(),
    ...options?.metadata,
  };

  if (options?.userId) {
    metadata.userId = options.userId;
  }

  return traceable(fn, {
    name: `${agentType}_agent`,
    tags,
    metadata,
  });
}

/**
 * Enable tracing globally at startup
 * Call this in index.ts and worker.ts
 *
 * Tracing is automatically enabled if LANGCHAIN_TRACING_V2=true in environment
 */
export async function initializeTracing(): Promise<void> {
  // Check if tracing is configured
  if (process.env.LANGCHAIN_TRACING_V2 === "true") {
    const projectName = process.env.LANGCHAIN_PROJECT;
    if (projectName) {
      console.log(`[Tracing] LangSmith tracing enabled for project: ${projectName}`);
    } else {
      console.log("[Tracing] LangSmith tracing enabled (LANGCHAIN_PROJECT not set, using default)");
    }
  } else {
    console.log("[Tracing] LangSmith tracing disabled (set LANGCHAIN_TRACING_V2=true to enable)");
  }
}
